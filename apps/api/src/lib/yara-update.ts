import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { audit } from './audit';
import { notify } from './notifications';
import { type Db, prisma } from './prisma';
import { s3 } from './s3';
import { readSetting, writeSetting } from './settings';
import {
  compileInWorker,
  dropFromWorker,
  scanContextOf,
  scanInWorker,
  validateInWorker,
} from './yara';
import type { RuleSet } from './yara-engine';
import {
  loadPackState,
  packRulesDir,
  savePackState,
  type YaraPack,
  yaraPackInfo,
  yaraPacks,
} from './yara-packs';
import { extractZipEntry, listZip } from './zip';

/**
 * Atualizacao automatica dos pacotes de regras YARA (item 150). O ZIP do commit e lido
 * em memoria, nada vai para o disco nem e executado. So entra o que passa nos filtros;
 * se um falhar, a atualizacao fica retida ate um admin aprovar ou descartar.
 */

/** Commit mais novo com pelo menos esta idade: da tempo de a fonte corrigir um erro. */
const MIN_COMMIT_AGE_DAYS = 7;
const CHECK_EVERY_DAYS = 7;
/** Mais do que isto mudando de uma vez pede a aprovacao de um admin. */
const MAX_CHANGE_RATIO = 0.2;
/** Compilar mais lento do que isto (com folga para pacotes pequenos) tambem. */
const MAX_COMPILE_RATIO = 2;
const COMPILE_SLACK_MS = 1_000;
const CLEAN_SAMPLES = 100;
const CLEAN_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_RULE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RULE_FILES = 5_000;
/** Nomes guardados por lista no historico. */
const MAX_LISTED = 50;
const SETTING_AUTO = 'yaraPackAutoUpdate';

export interface PackSource {
  /** Commit mais novo ate a data, ou null se nao houver. */
  latestCommit(repo: string, until: Date): Promise<{ sha: string; date: Date } | null>;
  zip(repo: string, sha: string): Promise<Buffer>;
}

const github: PackSource = {
  async latestCommit(repo, until) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=1&until=${until.toISOString()}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepLook' },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao listar os commits`);
    const [commit] = (await res.json()) as {
      sha: string;
      commit: { committer: { date: string } };
    }[];
    return commit ? { sha: commit.sha, date: new Date(commit.commit.committer.date) } : null;
  },
  async zip(repo, sha) {
    const res = await fetch(`https://codeload.github.com/${repo}/zip/${sha}`, {
      headers: { 'User-Agent': 'DeepLook' },
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao baixar o pacote`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_ZIP_BYTES) {
      throw new Error('o pacote passou do limite de tamanho');
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_ZIP_BYTES) throw new Error('o pacote passou do limite de tamanho');
    return body;
  },
};

let source: PackSource = github;
/** Para os testes: outra fonte (null volta para o GitHub). */
export function configurePackSource(next: PackSource | null) {
  source = next ?? github;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Arquivos de regras e licenca do ZIP, so em memoria. */
export function readReleaseZip(pack: YaraPack, zip: Buffer) {
  const entries = listZip(zip).filter((e) => !e.dir);
  if (entries.length > MAX_RULE_FILES * 4) throw new Error('o pacote tem arquivos demais');
  const files = new Map<string, string>();
  let license: string | null = null;
  const prefix = `${pack.folder}/`;
  for (const entry of entries) {
    // O ZIP do GitHub poe tudo dentro de uma pasta "<repo>-<commit>/".
    const path = entry.path.slice(entry.path.indexOf('/') + 1);
    if (/^licen[sc]e[^/]*$/i.test(path)) {
      license = sha256(extractZipEntry(zip, entry, '', MAX_RULE_FILE_BYTES));
      continue;
    }
    if (!path.startsWith(prefix) || !/\.ya?ra?$/i.test(path)) continue;
    const file = path.slice(prefix.length);
    if (pack.skipPrefixes.some((p) => file.startsWith(p))) continue;
    if (entry.size > MAX_RULE_FILE_BYTES) continue;
    let text: string;
    try {
      text = utf8.decode(extractZipEntry(zip, entry, '', MAX_RULE_FILE_BYTES));
    } catch {
      continue;
    }
    if (!text.includes('\0')) files.set(file, text);
    if (files.size > MAX_RULE_FILES) throw new Error('o pacote tem arquivos demais');
  }
  return { files, license };
}

export interface UpdatePlan {
  added: { file: string; source: string }[];
  changed: { id: string; file: string; source: string }[];
  removed: { id: string; file: string }[];
  /** Nao compilam: arquivo novo fica de fora; o que ja existe mantem a versao anterior. */
  kept: string[];
}

const setOf = (pack: YaraPack, id: string, name: string, text: string): RuleSet => ({
  id,
  name,
  source: text,
  pack: yaraPackInfo(pack.id),
});
const ruleName = (pack: YaraPack, file: string) => `${pack.id}/${file.replace(/\.[^.]+$/, '')}`;

async function planFrom(pack: YaraPack, files: Map<string, string>): Promise<UpdatePlan> {
  const state = await loadPackState();
  const deleted = new Set(state.deleted[pack.id] ?? []);
  const rows = await prisma.yaraRule.findMany({
    where: { pack: pack.id, packFile: { not: null } },
    select: { id: true, packFile: true, source: true },
  });
  const current = new Map(rows.map((r) => [r.packFile!, r]));
  const candidates = [...files.entries()].filter(
    ([file, text]) => !deleted.has(file) && current.get(file)?.source !== text,
  );
  const sets = candidates.map(([file, text], i) => setOf(pack, `c${i}`, file, text));
  const failed = await validateInWorker(sets);
  const kept = sets.filter((s) => failed.has(s.id)).map((s) => s.name);
  const usable = candidates.filter((_, i) => !failed.has(`c${i}`));
  return {
    added: usable
      .filter(([file]) => !current.has(file))
      .map(([file, text]) => ({ file, source: text })),
    changed: usable
      .filter(([file]) => current.has(file))
      .map(([file, text]) => ({ id: current.get(file)!.id, file, source: text })),
    removed: rows
      .filter((r) => !files.has(r.packFile!))
      .map((r) => ({ id: r.id, file: r.packFile! })),
    kept,
  };
}

/** Regra nova ou alterada que dispara numa amostra recente com veredito Limpo. */
async function cleanSampleHits(pack: YaraPack, plan: UpdatePlan, commit: string) {
  const fresh = [...plan.added, ...plan.changed];
  if (!fresh.length) return [];
  const samples = await prisma.entry.findMany({
    where: {
      type: 'FILE',
      verdict: 'CLEAN',
      storageKey: { not: null },
      filePurgedAt: null,
      fileSize: { lte: CLEAN_SAMPLE_MAX_BYTES },
    },
    orderBy: { createdAt: 'desc' },
    take: CLEAN_SAMPLES,
    select: {
      title: true,
      storageKey: true,
      bucket: true,
      originalFilename: true,
      staticInfo: true,
    },
  });
  const key = `candidate:${pack.id}`;
  const sets = fresh.map((f, i) => setOf(pack, `c${i}`, f.file, f.source));
  const found: string[] = [];
  try {
    for (const sample of samples) {
      let content: Buffer;
      try {
        const obj = await s3.send(
          new GetObjectCommand({
            Bucket: sample.bucket || env.S3_BUCKET,
            Key: sample.storageKey!,
          }),
        );
        content = Buffer.from(await obj.Body!.transformToByteArray());
      } catch {
        continue;
      }
      const hits = await scanInWorker(
        key,
        commit,
        async () => sets,
        content,
        scanContextOf(sample),
      );
      for (const hit of hits) found.push(`${hit.identifier} em "${sample.title}"`);
    }
  } finally {
    await dropFromWorker(key);
  }
  return found;
}

/** Tempo para compilar o pacote antes e depois. */
async function compileTimes(pack: YaraPack, plan: UpdatePlan) {
  const rows = await prisma.yaraRule.findMany({
    where: { pack: pack.id },
    select: { id: true, name: true, source: true, packFile: true },
  });
  const changed = new Map(plan.changed.map((c) => [c.id, c.source]));
  const removed = new Set(plan.removed.map((r) => r.id));
  const before = rows.map((r) => setOf(pack, r.id, r.name, r.source));
  const after = [
    ...rows
      .filter((r) => !removed.has(r.id))
      .map((r) => setOf(pack, r.id, r.name, changed.get(r.id) ?? r.source)),
    ...plan.added.map((a, i) => setOf(pack, `n${i}`, a.file, a.source)),
  ];
  return { before: await compileInWorker(before), after: await compileInWorker(after) };
}

/** Motivos para reter; vazio = pode aplicar sozinho. */
async function filterReasons(
  pack: YaraPack,
  plan: UpdatePlan,
  license: string | null,
  commit: string,
): Promise<string[]> {
  const reasons: string[] = [];
  const known = sha256(readFileSync(join(packRulesDir(pack.id), 'LICENSE')));
  if (license !== known) reasons.push('A licença da fonte mudou: é preciso ler antes de aceitar.');
  const total = await prisma.yaraRule.count({ where: { pack: pack.id } });
  const touched = plan.changed.length + plan.removed.length;
  if (total && touched / total > MAX_CHANGE_RATIO) {
    reasons.push(`Mudança grande: ${touched} de ${total} conjuntos alterados ou removidos.`);
  }
  const hits = await cleanSampleHits(pack, plan, commit);
  if (hits.length) {
    const shown = hits.slice(0, 5).join('; ');
    reasons.push(`Regra nova dispara em amostra Limpa: ${shown}.`);
  }
  if (plan.added.length || plan.changed.length || plan.removed.length) {
    const { before, after } = await compileTimes(pack, plan);
    if (after > before * MAX_COMPILE_RATIO + COMPILE_SLACK_MS) {
      reasons.push(`Compilação mais lenta: de ${before} ms para ${after} ms.`);
    }
  }
  return reasons;
}

const summaryOf = (plan: UpdatePlan) => ({
  added: plan.added.length,
  changed: plan.changed.length,
  removed: plan.removed.length,
  kept: plan.kept.length,
  files: {
    added: plan.added.slice(0, MAX_LISTED).map((a) => a.file),
    changed: plan.changed.slice(0, MAX_LISTED).map((c) => c.file),
    removed: plan.removed.slice(0, MAX_LISTED).map((r) => r.file),
    kept: plan.kept.slice(0, MAX_LISTED),
  },
});

async function notifyAdmins(tx: Db, detail: string, actorId: string | null) {
  const admins = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  await notify(
    tx,
    admins.map((a) => ({ userId: a.id, type: 'YARA_PACK_UPDATE' as const, actorId, detail })),
  );
}

/** Aplica tudo de uma vez; a versao anterior fica guardada para voltar. */
async function applyPlan(
  pack: YaraPack,
  plan: UpdatePlan,
  commit: { sha: string; date: Date },
  actorId: string | null,
  releaseId?: string,
) {
  const state = await loadPackState();
  const old = await prisma.yaraRule.findMany({
    where: { id: { in: [...plan.changed, ...plan.removed].map((r) => r.id) } },
    select: { id: true, packFile: true, source: true, enabled: true, name: true },
  });
  const undo = {
    commit: state.commits[pack.id] ?? pack.commit,
    commitDate: state.commitDates[pack.id] ?? pack.commitDate,
    changed: old
      .filter((r) => plan.changed.some((c) => c.id === r.id))
      .map((r) => ({ id: r.id, source: r.source })),
    removed: old
      .filter((r) => plan.removed.some((c) => c.id === r.id))
      .map((r) => ({ file: r.packFile, source: r.source, enabled: r.enabled, name: r.name })),
    added: plan.added.map((a) => a.file),
  };
  const summary = summaryOf(plan);
  const release = await prisma.$transaction(async (tx) => {
    for (const c of plan.changed) {
      await tx.yaraRule.update({ where: { id: c.id }, data: { source: c.source } });
    }
    if (plan.removed.length) {
      await tx.yaraRule.deleteMany({ where: { id: { in: plan.removed.map((r) => r.id) } } });
    }
    await tx.yaraRule.createMany({
      data: plan.added.map((a) => ({
        name: ruleName(pack, a.file),
        source: a.source,
        pack: pack.id,
        packFile: a.file,
      })),
      skipDuplicates: true,
    });
    // So a ultima atualizacao aplicada pode voltar.
    await tx.yaraPackRelease.updateMany({
      where: { pack: pack.id, status: 'APPLIED' },
      data: { undo: Prisma.DbNull, canRollback: false },
    });
    await tx.yaraPackRelease.updateMany({
      where: { pack: pack.id, status: 'HELD', id: { not: releaseId ?? '' } },
      data: { status: 'DISMISSED' },
    });
    const data = {
      status: 'APPLIED' as const,
      summary: summary as unknown as Prisma.InputJsonValue,
      undo: undo as unknown as Prisma.InputJsonValue,
      canRollback: true,
      appliedAt: new Date(),
    };
    const saved = releaseId
      ? await tx.yaraPackRelease.update({ where: { id: releaseId }, data })
      : await tx.yaraPackRelease.create({
          data: { ...data, pack: pack.id, commit: commit.sha, commitDate: commit.date },
        });
    const detail = `${pack.name} atualizado: ${plan.added.length} novos, ${plan.changed.length} alterados, ${plan.removed.length} removidos`;
    await audit(tx, null, {
      action: 'YARA_PACK_UPDATED',
      actorId,
      targetLabel: pack.name,
      detail: `${detail} (commit ${commit.sha.slice(0, 8)})`,
    });
    await notifyAdmins(tx, detail, actorId);
    return saved;
  });
  state.commits[pack.id] = commit.sha;
  state.commitDates[pack.id] = commit.date.toISOString().slice(0, 10);
  await savePackState(state);
  return release;
}

export type CheckOutcome =
  | { outcome: 'current' }
  | { outcome: 'skipped'; commit: string }
  | { outcome: 'preview' | 'applied'; commit: string; summary: ReturnType<typeof summaryOf> }
  | { outcome: 'held'; commit: string; reasons: string[]; summary: ReturnType<typeof summaryOf> };

/** Uma verificacao por vez: compilar e varrer as amostras limpas pesa. */
let busy = false;

/**
 * Verifica um pacote. `apply: false` so mostra o que mudaria. Com `apply`, o que passa
 * nos filtros entra; o que nao passa fica retido, um registro por commit.
 */
export async function checkYaraPack(
  id: string,
  options: { apply: boolean; actorId: string | null },
): Promise<CheckOutcome> {
  const pack = yaraPacks().find((p) => p.id === id);
  if (!pack) throw new Error('Pacote não encontrado.');
  if (busy) throw new Error('Já há uma verificação em andamento. Tente de novo em instantes.');
  busy = true;
  const state = await loadPackState();
  try {
    const until = new Date(Date.now() - MIN_COMMIT_AGE_DAYS * 86_400_000);
    const commit = await source.latestCommit(pack.repo, until);
    const currentSha = state.commits[id] ?? pack.commit;
    const currentDate = state.commitDates[id] ?? pack.commitDate;
    let result: CheckOutcome;
    if (
      !commit ||
      commit.sha === currentSha ||
      commit.date.toISOString().slice(0, 10) <= currentDate
    ) {
      result = { outcome: 'current' };
    } else if (state.skippedCommits[id] === commit.sha) {
      // Um admin voltou esta versao: so uma mais nova tenta de novo.
      result = { outcome: 'skipped', commit: commit.sha };
    } else {
      const { files, license } = readReleaseZip(pack, await source.zip(pack.repo, commit.sha));
      if (!files.size) throw new Error('o pacote veio sem regras');
      const plan = await planFrom(pack, files);
      const reasons = await filterReasons(pack, plan, license, commit.sha);
      const summary = summaryOf(plan);
      if (reasons.length) {
        result = { outcome: 'held', commit: commit.sha, reasons, summary };
        const seen = await prisma.yaraPackRelease.count({
          where: { pack: id, commit: commit.sha },
        });
        if (!seen) {
          await prisma.$transaction(async (tx) => {
            await tx.yaraPackRelease.create({
              data: {
                pack: id,
                commit: commit.sha,
                commitDate: commit.date,
                status: 'HELD',
                summary: summary as unknown as Prisma.InputJsonValue,
                reasons,
              },
            });
            await audit(tx, null, {
              action: 'YARA_PACK_UPDATED',
              actorId: options.actorId,
              targetLabel: pack.name,
              detail: `retida: ${reasons.join(' ')}`,
            });
            await notifyAdmins(tx, `${pack.name}: atualização retida para aprovação`, null);
          });
        }
      } else if (options.apply) {
        await applyPlan(pack, plan, commit, options.actorId);
        result = { outcome: 'applied', commit: commit.sha, summary };
      } else {
        result = { outcome: 'preview', commit: commit.sha, summary };
      }
    }
    const fresh = await loadPackState();
    fresh.lastCheck[id] = new Date().toISOString();
    delete fresh.lastError[id];
    await savePackState(fresh);
    return result;
  } catch (err) {
    const fresh = await loadPackState();
    fresh.lastCheck[id] = new Date().toISOString();
    fresh.lastError[id] = (err as Error).message.slice(0, 300);
    await savePackState(fresh);
    throw err;
  } finally {
    busy = false;
  }
}

/** Admin aprova uma atualizacao retida: baixa o mesmo commit e aplica sem os filtros. */
export async function approveRelease(id: string, actorId: string) {
  const release = await prisma.yaraPackRelease.findUnique({ where: { id } });
  if (!release || release.status !== 'HELD') return null;
  const pack = yaraPacks().find((p) => p.id === release.pack);
  if (!pack) return null;
  if (busy) throw new Error('Já há uma verificação em andamento. Tente de novo em instantes.');
  busy = true;
  try {
    const { files } = readReleaseZip(pack, await source.zip(pack.repo, release.commit));
    const plan = await planFrom(pack, files);
    return await applyPlan(
      pack,
      plan,
      { sha: release.commit, date: release.commitDate },
      actorId,
      id,
    );
  } finally {
    busy = false;
  }
}

/** Descarta uma retida: este commit nao e oferecido de novo. */
export async function dismissRelease(id: string, actorId: string) {
  const release = await prisma.yaraPackRelease.findUnique({ where: { id } });
  if (!release || release.status !== 'HELD') return null;
  const state = await loadPackState();
  state.skippedCommits[release.pack] = release.commit;
  await savePackState(state);
  const saved = await prisma.yaraPackRelease.update({
    where: { id },
    data: { status: 'DISMISSED' },
  });
  await audit(prisma, null, {
    action: 'YARA_PACK_UPDATED',
    actorId,
    targetLabel: release.pack,
    detail: `retida descartada (commit ${release.commit.slice(0, 8)})`,
  });
  return saved;
}

interface Undo {
  commit: string;
  commitDate: string;
  changed: { id: string; source: string }[];
  removed: { file: string; source: string; enabled: boolean; name: string }[];
  added: string[];
}

/** Volta a ultima atualizacao; este commit nao volta sozinho, so um mais novo. */
export async function rollbackRelease(id: string, actorId: string) {
  const release = await prisma.yaraPackRelease.findUnique({ where: { id } });
  if (!release?.canRollback || !release.undo) return null;
  const undo = release.undo as unknown as Undo;
  const saved = await prisma.$transaction(async (tx) => {
    for (const c of undo.changed) {
      await tx.yaraRule.updateMany({ where: { id: c.id }, data: { source: c.source } });
    }
    await tx.yaraRule.deleteMany({ where: { pack: release.pack, packFile: { in: undo.added } } });
    await tx.yaraRule.createMany({
      data: undo.removed.map((r) => ({
        name: r.name,
        source: r.source,
        enabled: r.enabled,
        pack: release.pack,
        packFile: r.file,
      })),
      skipDuplicates: true,
    });
    await audit(tx, null, {
      action: 'YARA_PACK_UPDATED',
      actorId,
      targetLabel: release.pack,
      detail: `voltou para o commit ${undo.commit.slice(0, 8)}`,
    });
    return tx.yaraPackRelease.update({
      where: { id },
      data: { status: 'ROLLED_BACK', canRollback: false, undo: Prisma.DbNull },
    });
  });
  const state = await loadPackState();
  state.commits[release.pack] = undo.commit;
  state.commitDates[release.pack] = undo.commitDate;
  state.skippedCommits[release.pack] = release.commit;
  await savePackState(state);
  return saved;
}

export const autoUpdateEnabled = async () => (await readSetting(SETTING_AUTO)) !== false;
export const setAutoUpdate = (value: boolean) => writeSetting(SETTING_AUTO, value);

/** O que a tela de Configuracoes mostra. */
export async function yaraUpdateStatus() {
  const state = await loadPackState();
  const releases = await prisma.yaraPackRelease.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      pack: true,
      commit: true,
      commitDate: true,
      status: true,
      summary: true,
      reasons: true,
      canRollback: true,
      createdAt: true,
      appliedAt: true,
    },
  });
  return {
    autoUpdate: await autoUpdateEnabled(),
    packs: yaraPacks().map((p) => ({
      id: p.id,
      name: p.name,
      commit: state.commits[p.id] ?? p.commit,
      commitDate: state.commitDates[p.id] ?? p.commitDate,
      lastCheck: state.lastCheck[p.id] ?? null,
      lastError: state.lastError[p.id] ?? null,
    })),
    releases,
  };
}

/** Verifica os pacotes ligados cuja ultima verificacao ja passou do prazo. Nunca lanca. */
export async function runDuePackChecks(
  log: { warn: (msg: string) => void },
  now = Date.now(),
): Promise<void> {
  if (!(await autoUpdateEnabled())) return;
  const state = await loadPackState();
  for (const pack of yaraPacks()) {
    const on = state.enabled[pack.id] ?? pack.defaultEnabled;
    if (!on || !state.installed.includes(pack.id)) continue;
    const last = state.lastCheck[pack.id] ? Date.parse(state.lastCheck[pack.id]) : 0;
    if (now - last < CHECK_EVERY_DAYS * 86_400_000) continue;
    try {
      await checkYaraPack(pack.id, { apply: true, actorId: null });
    } catch (err) {
      log.warn(`[yara] pacote ${pack.id} não atualizado: ${(err as Error).message}`);
    }
  }
}

/** Confere uma vez por dia; a primeira, alguns minutos depois de subir. */
export function startYaraPackUpdates(log: { warn: (msg: string) => void }) {
  const run = () =>
    void runDuePackChecks(log).catch((err: unknown) =>
      log.warn(`[yara] verificação dos pacotes falhou: ${(err as Error).message}`),
    );
  setTimeout(run, 10 * 60_000).unref();
  setInterval(run, 24 * 3_600_000).unref();
}
