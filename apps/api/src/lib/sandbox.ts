import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Entry, Prisma, SandboxSession } from '@prisma/client';

import { env } from '../env';
import { recordEvent } from './events';
import { prisma } from './prisma';
import { pve, pveNode, pveUploadIso, waitTask } from './proxmox';
import { s3 } from './s3';

const execFileAsync = promisify(execFile);

/** Prefixo dos volumes ISO criados pelo DeepLook (usado na limpeza). */
const ISO_PREFIX = 'deeplook-';

/** Sessoes com provisionamento em andamento neste processo (trava simples). */
const provisioning = new Set<string>();

const ACTIVE_STATUSES: SandboxSession['status'][] = [
  'REQUESTED',
  'PROVISIONING',
  'RUNNING',
  'STOPPING',
];

export function isActive(status: SandboxSession['status']): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Nome da VM no Proxmox (precisa ser "DNS-like": letras, digitos e hifen). */
function vmName(entry: Entry): string {
  const stamp = (entry.sha256 ?? entry.id)
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  const rand = Math.random().toString(36).slice(2, 6);
  return `${env.SANDBOX_TAG}-${stamp}-${rand}`;
}

/** Nome do arquivo ISO no storage (unico por sessao). */
function isoTarget(sessionId: string): { filename: string; volume: string } {
  const filename = `${ISO_PREFIX}${sessionId}.iso`;
  return { filename, volume: `${env.PROXMOX_ISO_STORAGE}:iso/${filename}` };
}

/** Nome seguro para o arquivo dentro do ISO (mantem a extensao). */
function sampleFileName(entry: Entry): string {
  const raw = entry.originalFilename || 'amostra.bin';
  const cleaned = raw
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'amostra.bin';
}

async function setPhase(sessionId: string, phase: string): Promise<void> {
  await prisma.sandboxSession
    .update({ where: { id: sessionId }, data: { phase } })
    .catch(() => undefined);
}

async function failSession(sessionId: string, message: string): Promise<void> {
  const failed = await prisma.sandboxSession
    .update({
      where: { id: sessionId },
      data: { status: 'FAILED', phase: null, lastError: message.slice(0, 500) },
      select: { entryId: true },
    })
    .catch(() => null);
  // Falha no provisionamento entra no historico da amostra (autor: sistema).
  if (failed) {
    await recordEvent(prisma, {
      entryId: failed.entryId,
      actorId: null,
      type: 'SANDBOX_FAILED',
      detail: message.slice(0, 500),
    }).catch(() => undefined);
  }
}

/** Sessao ativa (nao finalizada) de uma amostra. */
export async function activeSessionForEntry(entryId: string) {
  return prisma.sandboxSession.findFirst({
    where: { entryId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
    include: {
      analyst: { select: { id: true, displayName: true } },
      entry: { select: { id: true, title: true } },
    },
  });
}

export async function countActive(): Promise<{
  total: number;
  perAnalyst: (id: string) => Promise<number>;
}> {
  const total = await prisma.sandboxSession.count({ where: { status: { in: ACTIVE_STATUSES } } });
  return {
    total,
    perAnalyst: (analystId: string) =>
      prisma.sandboxSession.count({
        where: { analystId, status: { in: ACTIVE_STATUSES } },
      }),
  };
}

export type CreateSessionResult =
  { ok: true; session: SandboxSession } | { ok: false; code: number; error: string };

/** Cria a sessao de sandbox e dispara o provisionamento em background. */
export async function createSession(entry: Entry, analystId: string): Promise<CreateSessionResult> {
  if (entry.type !== 'FILE' || !entry.storageKey) {
    return { ok: false, code: 400, error: 'Somente amostras de arquivo podem ir para o sandbox.' };
  }

  const existing = await activeSessionForEntry(entry.id);
  if (existing) {
    return { ok: false, code: 409, error: 'Ja existe um ambiente ativo para esta amostra.' };
  }

  const active = await countActive();
  if (active.total >= env.SANDBOX_MAX_ACTIVE) {
    return {
      ok: false,
      code: 409,
      error: `Limite de ${env.SANDBOX_MAX_ACTIVE} ambientes ativos atingido. Descarte um ambiente antes de criar outro.`,
    };
  }
  const mine = await active.perAnalyst(analystId);
  if (mine >= env.SANDBOX_MAX_PER_USER) {
    return {
      ok: false,
      code: 409,
      error: `Voce ja tem ${mine} ambiente(s) ativo(s) (limite: ${env.SANDBOX_MAX_PER_USER}).`,
    };
  }

  const session = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId,
      node: pveNode(),
      name: vmName(entry),
      status: 'REQUESTED',
      phase: 'na-fila',
      expiresAt: new Date(Date.now() + env.SANDBOX_TTL_MINUTES * 60_000),
    },
  });

  void provision(session.id).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await failSession(session.id, message);
  });

  return { ok: true, session };
}

export async function getSession(id: string) {
  return prisma.sandboxSession.findUnique({
    where: { id },
    include: {
      entry: {
        select: {
          id: true,
          title: true,
          sha256: true,
          originalFilename: true,
          fileSize: true,
          owner: { select: { id: true, displayName: true } },
        },
      },
      analyst: { select: { id: true, displayName: true } },
    },
  });
}

export async function listSessions(where: Prisma.SandboxSessionWhereInput) {
  return prisma.sandboxSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      entry: { select: { id: true, title: true, sha256: true } },
      analyst: { select: { id: true, displayName: true } },
    },
  });
}

async function runGenisoimage(payloadDir: string, outFile: string): Promise<void> {
  try {
    await execFileAsync(
      'genisoimage',
      ['-quiet', '-J', '-R', '-V', 'DEEPLOOK', '-o', outFile, payloadDir],
      { timeout: 10 * 60_000 },
    );
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error(
        'genisoimage nao encontrado na imagem da API (o Dockerfile instala o pacote genisoimage).',
        { cause: err },
      );
    }
    throw new Error(
      `Falha ao gerar a ISO da amostra: ${e.stderr || e.message || 'erro desconhecido'}`,
      { cause: err },
    );
  }
}

/**
 * Baixa a amostra do MinIO e monta uma ISO9660 (Joliet + Rock Ridge) com a
 * amostra, o SHA-256 e um LEIA-ME. E assim que a amostra entra na VM isolada
 * (CD-ROM somente leitura: nao depende de rede nem de agente no guest).
 */
async function buildSampleIso(
  session: SandboxSession,
  entry: Entry,
): Promise<{ path: string; size: number; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'deeplook-iso-'));
  const payloadDir = join(dir, 'payload');
  await mkdir(payloadDir, { recursive: true });

  const name = sampleFileName(entry);
  const samplePath = join(payloadDir, name);

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: entry.bucket || env.S3_BUCKET,
      Key: entry.storageKey as string,
    }),
  );
  await pipeline(obj.Body as NodeJS.ReadableStream, createWriteStream(samplePath));

  await writeFile(
    join(payloadDir, 'SHA256.txt'),
    [
      `Arquivo:  ${name}`,
      `SHA-256:  ${entry.sha256 ?? '(nao calculado)'}`,
      `Tamanho:  ${entry.fileSize ?? 0} bytes`,
      `Amostra:  ${entry.title}`,
      `Ambiente: ${session.name}`,
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(payloadDir, 'LEIA-ME.txt'),
    [
      'DEEPLOOK - ambiente isolado de analise',
      '',
      'Esta unidade de CD contem a amostra enviada para triagem (somente leitura).',
      '',
      '1. Copie o arquivo para a area de trabalho da VM.',
      '2. Execute com o monitoramento que preferir (Process Monitor, Wireshark...).',
      '3. Registre o veredito e as evidencias no relatorio do DeepLook.',
      '',
      'AVISO: a amostra pode ser maliciosa. Nao exponha esta VM a rede.',
      '',
    ].join('\n'),
    'utf8',
  );

  const isoPath = join(dir, 'sample.iso');
  await runGenisoimage(payloadDir, isoPath);
  const info = await stat(isoPath);

  return { path: isoPath, size: info.size, dir };
}

/** Clona o template; se o linked clone nao for possivel, refaz como copia cheia. */
async function cloneTemplate(vmid: number, name: string): Promise<void> {
  const path = `/nodes/${pveNode()}/qemu/${env.PROXMOX_TEMPLATE_VMID}/clone`;
  const base = { newid: vmid, name };

  try {
    const upid = await pve<string>(path, { method: 'POST', body: { ...base, full: false } });
    await waitTask(upid);
    return;
  } catch {
    // Sem snapshot no template o linked clone falha: limpa e tenta copia cheia.
    await pve(`/nodes/${pveNode()}/qemu/${vmid}`, {
      method: 'DELETE',
      body: { purge: true },
    }).catch(() => undefined);
    const upid = await pve<string>(path, { method: 'POST', body: { ...base, full: true } });
    await waitTask(upid);
  }
}

/** Pipeline completo: ISO -> upload -> clone -> config -> start. */
export async function provision(sessionId: string): Promise<void> {
  if (provisioning.has(sessionId)) return;
  provisioning.add(sessionId);

  let tempDir: string | null = null;

  try {
    const session = await prisma.sandboxSession.findUnique({
      where: { id: sessionId },
      include: { entry: true },
    });
    if (!session) return;
    const entry = session.entry;

    await prisma.sandboxSession.update({
      where: { id: sessionId },
      data: { status: 'PROVISIONING', lastError: null },
    });

    // 1. Gera a ISO com a amostra dentro.
    await setPhase(sessionId, 'gerando-iso');
    const iso = await buildSampleIso(session, entry);
    tempDir = iso.dir;

    // 2. Sobe a ISO para o storage do PVE.
    await setPhase(sessionId, 'enviando-iso');
    const { filename, volume } = isoTarget(sessionId);
    const uploadUpid = await pveUploadIso(filename, createReadStream(iso.path), iso.size);
    await prisma.sandboxSession.update({
      where: { id: sessionId },
      data: { upid: uploadUpid, isoVolume: volume },
    });
    await waitTask(uploadUpid, 30 * 60_000);

    // 3. Clona o template.
    await setPhase(sessionId, 'clonando');
    const nextId = Number(await pve<string>('/cluster/nextid'));
    await prisma.sandboxSession.update({
      where: { id: sessionId },
      data: { vmid: nextId, node: pveNode() },
    });
    await cloneTemplate(nextId, session.name);

    // 4. Configura a VM (nome, etiqueta e a ISO como CD-ROM somente leitura).
    await setPhase(sessionId, 'configurando');
    await pve(`/nodes/${pveNode()}/qemu/${nextId}/config`, {
      method: 'PUT',
      body: {
        name: session.name,
        description: `DeepLook sandbox | amostra ${entry.id} | sha256 ${entry.sha256 ?? '-'} | sessao ${session.id}`,
        tags: env.SANDBOX_TAG,
        // media=cdrom ja cria um CD-ROM somente leitura no QEMU. O barramento IDE
        // (ide2) NAO aceita o sub-campo ro=1 (so o SCSI aceita); manda-lo faz o PVE
        // responder "ide2.ro: property is not defined in schema".
        ide2: `${volume},media=cdrom`,
      },
    });

    // 5. Liga a VM.
    await setPhase(sessionId, 'iniciando');
    const startUpid = await pve<string>(`/nodes/${pveNode()}/qemu/${nextId}/status/start`, {
      method: 'POST',
    });
    await waitTask(startUpid);

    await prisma.sandboxSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', phase: null, startedAt: new Date(), lastError: null },
    });
  } finally {
    provisioning.delete(sessionId);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function currentStatus(node: string, vmid: number): Promise<string | null> {
  try {
    const data = await pve<{ status?: string }>(`/nodes/${node}/qemu/${vmid}/status/current`);
    return data?.status ?? null;
  } catch {
    return null;
  }
}

async function waitStopped(node: string, vmid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await currentStatus(node, vmid)) !== 'running') return;
    await sleep(1500);
  }
}

/** Nome do arquivo dentro do volume (`local:iso/x.iso` -> `x.iso`). */
function baseName(volid: string): string {
  const afterColon = volid.includes(':') ? volid.slice(volid.indexOf(':') + 1) : volid;
  const parts = afterColon.split('/');
  return parts[parts.length - 1];
}

async function deleteIso(volume: string): Promise<void> {
  try {
    await pve(
      `/nodes/${pveNode()}/storage/${env.PROXMOX_ISO_STORAGE}/content/${encodeURIComponent(volume)}`,
      { method: 'DELETE' },
    );
  } catch {
    /* ISO ja removido: nao e erro */
  }
}

/**
 * Encerra a sessao: desliga a VM, destroi o clone e apaga o ISO da amostra.
 * Nunca lanca: usado pelo reaper e pelo descarte manual.
 */
export async function dispose(
  sessionId: string,
  finalStatus: 'STOPPED' | 'EXPIRED' = 'STOPPED',
): Promise<void> {
  const session = await prisma.sandboxSession.findUnique({ where: { id: sessionId } });
  if (!session) return;

  await prisma.sandboxSession
    .update({ where: { id: sessionId }, data: { status: 'STOPPING', phase: 'encerrando' } })
    .catch(() => undefined);

  const node = session.node || pveNode();
  const vmid = session.vmid;

  if (vmid) {
    // 1. Desligamento gracioso (o guest agent/ACPI cuida disso), com timeout.
    try {
      await pve(`/nodes/${node}/qemu/${vmid}/status/shutdown`, {
        method: 'POST',
        body: { timeout: 20 },
      });
      await waitStopped(node, vmid, 30_000);
    } catch {
      /* segue para o desligamento a forca */
    }

    // 2. Se ainda estiver ligada, derruba.
    if ((await currentStatus(node, vmid)) === 'running') {
      try {
        const upid = await pve<string>(`/nodes/${node}/qemu/${vmid}/status/stop`, {
          method: 'POST',
        });
        await waitTask(upid, 60_000);
      } catch {
        /* ignora: a destruicao abaixo resolve */
      }
    }

    // 3. Destroi a VM e os discos do clone.
    try {
      const upid = await pve<string>(`/nodes/${node}/qemu/${vmid}`, {
        method: 'DELETE',
        body: { purge: true, 'destroy-unreferenced-disks': true },
      });
      await waitTask(upid, 120_000);
    } catch (err) {
      console.warn(
        `[sandbox] falha ao destruir a VM ${vmid}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 4. Apaga o ISO da amostra.
  if (session.isoVolume) await deleteIso(session.isoVolume);

  await prisma.sandboxSession.update({
    where: { id: sessionId },
    data: { status: finalStatus, phase: null, stoppedAt: new Date() },
  });
}

/** Encerra todas as sessoes cujo TTL venceu. */
export async function reapExpired(): Promise<number> {
  const expired = await prisma.sandboxSession.findMany({
    where: { status: { in: ACTIVE_STATUSES }, expiresAt: { lt: new Date() } },
    select: { id: true, entryId: true },
  });

  for (const item of expired) {
    await dispose(item.id, 'EXPIRED')
      .then(() =>
        // Encerramento automatico: o "autor" do evento e o sistema (actorId null).
        recordEvent(prisma, {
          entryId: item.entryId,
          actorId: null,
          type: 'SANDBOX_CLOSED',
          detail: 'expirado',
        }),
      )
      .catch((err: unknown) => {
        console.warn(
          `[sandbox] falha ao expirar ${item.id}: ${err instanceof Error ? err.message : err}`,
        );
      });
  }

  if (expired.length) {
    console.log(`[sandbox] reaper encerrou ${expired.length} ambiente(s) expirado(s).`);
  }
  return expired.length;
}

/** Provisionamentos interrompidos (API reiniciada) viram FAILED. */
export async function recoverStuckSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const stuck = await prisma.sandboxSession.findMany({
    where: { status: { in: ['REQUESTED', 'PROVISIONING'] }, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  // Um a um (sao poucos): cada falha tambem vai para o historico da amostra.
  for (const session of stuck) {
    await failSession(session.id, 'Provisionamento interrompido (API reiniciada). Tente de novo.');
  }
  return stuck.length;
}

/**
 * Limpa o que sobrou de execucoes anteriores: VMs com a nossa etiqueta e
 * ISOs `deeplook-*` que nao pertencem a nenhuma sessao ativa.
 */
export async function reconcileOrphans(): Promise<{ vms: number; isos: number }> {
  const active = await prisma.sandboxSession.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: { vmid: true, isoVolume: true },
  });
  const activeVmids = new Set(
    active.map((s) => s.vmid).filter((v): v is number => typeof v === 'number'),
  );
  const activeIsos = new Set(
    active
      .map((s) => s.isoVolume)
      .filter((v): v is string => Boolean(v))
      .map(baseName),
  );

  let vms = 0;
  let isos = 0;

  try {
    const list = await pve<{ vmid: number; name?: string; tags?: string }[]>(
      `/nodes/${pveNode()}/qemu`,
    );
    for (const vm of list ?? []) {
      const ours =
        (vm.tags ?? '').split(';').includes(env.SANDBOX_TAG) ||
        (vm.name ?? '').startsWith(`${env.SANDBOX_TAG}-`);
      if (!ours || activeVmids.has(vm.vmid)) continue;
      try {
        await pve(`/nodes/${pveNode()}/qemu/${vm.vmid}`, {
          method: 'DELETE',
          body: { purge: true },
        });
        vms += 1;
      } catch {
        /* ignora VM que ja sumiu */
      }
    }
  } catch (err) {
    console.warn(
      `[sandbox] nao foi possivel listar VMs: ${err instanceof Error ? err.message : err}`,
    );
  }

  try {
    const list = await pve<{ volid: string }[]>(
      `/nodes/${pveNode()}/storage/${env.PROXMOX_ISO_STORAGE}/content?content=iso`,
    );
    for (const item of list ?? []) {
      const name = baseName(item.volid);
      if (!name.startsWith(ISO_PREFIX) || activeIsos.has(name)) continue;
      await deleteIso(item.volid);
      isos += 1;
    }
  } catch (err) {
    console.warn(
      `[sandbox] nao foi possivel listar ISOs: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (vms || isos) {
    console.log(`[sandbox] reconciliacao removeu ${vms} VM(s) e ${isos} ISO(s) orfaos.`);
  }
  return { vms, isos };
}

/** Liga o reaper (roda a cada minuto enquanto a API estiver de pe). */
export function startSandboxReaper(): void {
  const timer = setInterval(() => {
    void reapExpired().catch((err: unknown) => {
      console.warn(`[sandbox] reaper falhou: ${err instanceof Error ? err.message : err}`);
    });
  }, 60_000);
  timer.unref();
}
