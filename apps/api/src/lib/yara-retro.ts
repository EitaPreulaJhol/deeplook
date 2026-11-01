import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from './prisma';
import { s3 } from './s3';
import { dropFromWorker, scanInWorker, type YaraHit } from './yara';
import { yaraPackInfo } from './yara-packs';

/**
 * YARA retroativo (item 67): aplica UMA regra as amostras ja guardadas, em
 * segundo plano e uma varredura por vez. Os acertos vao para a lista da
 * varredura e para a secao YARA da ficha (mesclados com os das outras regras).
 */

/** Arquivos maiores ficam de fora (cada um e lido inteiro na memoria). */
export const RETRO_MAX_BYTES = 100 * 1024 * 1024;
/** Grava o progresso a cada N amostras (a tela atualiza a cada 2 s). */
const PROGRESS_EVERY = 10;
const PAGE = 100;

/** Varreduras com pedido de cancelamento (checado a cada amostra). */
const cancelRequested = new Set<string>();

/** Amostras que entram na varredura: arquivos ainda guardados, fora da lixeira. */
const candidates = {
  type: 'FILE',
  storageKey: { not: null },
  filePurgedAt: null,
} satisfies Prisma.EntryWhereInput;

type Log = { error: (obj: object, msg: string) => void };

export async function startRetroscan(
  ruleId: string,
  actorId: string,
  log: Log,
): Promise<
  | { ok: true; retroscan: { id: string; total: number; skipped: number } }
  | { ok: false; code: number; error: string }
> {
  const rule = await prisma.yaraRule.findUnique({
    where: { id: ruleId },
    select: { id: true, name: true, source: true, pack: true },
  });
  if (!rule) return { ok: false, code: 404, error: 'Regra não encontrada.' };
  const running = await prisma.yaraRetroscan.findFirst({
    where: { status: 'RUNNING' },
    select: { ruleName: true },
  });
  if (running) {
    return {
      ok: false,
      code: 409,
      error: `Já há uma varredura retroativa em andamento (regra "${running.ruleName}"). Aguarde ou cancele-a.`,
    };
  }
  const [total, skipped] = await Promise.all([
    prisma.entry.count({ where: { ...candidates, fileSize: { lte: RETRO_MAX_BYTES } } }),
    prisma.entry.count({ where: { ...candidates, fileSize: { gt: RETRO_MAX_BYTES } } }),
  ]);
  const retroscan = await prisma.yaraRetroscan.create({
    data: { ruleId: rule.id, ruleName: rule.name, total, skipped, startedById: actorId },
    select: { id: true, total: true, skipped: true },
  });
  void run(retroscan.id, rule).catch(async (err) => {
    log.error({ err }, '[yara] varredura retroativa falhou');
    await prisma.yaraRetroscan.update({
      where: { id: retroscan.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: err instanceof Error ? err.message.slice(0, 300) : 'falha',
      },
    });
  });
  return { ok: true, retroscan };
}

export async function cancelRetroscan(id: string): Promise<boolean> {
  const found = await prisma.yaraRetroscan.findUnique({ where: { id }, select: { status: true } });
  if (found?.status !== 'RUNNING') return false;
  cancelRequested.add(id);
  return true;
}

/** API reiniciada no meio de uma varredura: ela nao continua sozinha. */
export async function failInterruptedRetroscans(): Promise<number> {
  const { count } = await prisma.yaraRetroscan.updateMany({
    where: { status: 'RUNNING' },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      error: 'Interrompida (API reiniciada). Inicie de novo.',
    },
  });
  return count;
}

async function readFile(entry: { storageKey: string | null; bucket: string | null }) {
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey! }),
  );
  return Buffer.from(await obj.Body!.transformToByteArray());
}

/**
 * Acertos desta regra na ficha: tira os anteriores do mesmo conjunto (a regra
 * pode ter mudado) e poe os novos, sem mexer nos das outras regras.
 */
async function mergeIntoScan(entryId: string, ruleName: string, hits: YaraHit[]) {
  const scan = await prisma.yaraScan.findUnique({ where: { entryId } });
  const previous = (scan?.matches as unknown as YaraHit[] | undefined) ?? [];
  const others = previous.filter((h) => h.rule !== ruleName);
  if (!hits.length && others.length === previous.length) return; // nada muda
  const matches = [...others, ...hits];
  const data = {
    status: matches.length ? ('MATCHED' as const) : ('CLEAN' as const),
    matches: matches as unknown as Prisma.InputJsonValue,
    error: null,
    scannedAt: new Date(),
  };
  await prisma.yaraScan.upsert({
    where: { entryId },
    create: { entryId, ...data, rulesCount: 1 },
    update: data,
  });
}

async function run(
  id: string,
  rule: { id: string; name: string; source: string; pack: string | null },
) {
  const key = `retro:${id}`;
  const loadRule = async () => [{ ...rule, pack: yaraPackInfo(rule.pack) }];
  let scanned = 0;
  let matched = 0;
  let failed = 0;
  let cursor: string | undefined;
  const progress = () =>
    prisma.yaraRetroscan.update({ where: { id }, data: { scanned, matched, failed } });
  try {
    for (;;) {
      const page = await prisma.entry.findMany({
        where: { ...candidates, fileSize: { lte: RETRO_MAX_BYTES } },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: { id: true, storageKey: true, bucket: true },
      });
      if (!page.length) break;
      for (const entry of page) {
        if (cancelRequested.has(id)) {
          await prisma.yaraRetroscan.update({
            where: { id },
            data: { scanned, matched, failed, status: 'CANCELLED', finishedAt: new Date() },
          });
          return;
        }
        try {
          const content = new Uint8Array(await readFile(entry));
          const hits = await scanInWorker(key, id, loadRule, content);
          await mergeIntoScan(entry.id, rule.name, hits);
          if (hits.length) {
            matched += 1;
            await prisma.yaraRetroscanHit.create({
              data: {
                retroscanId: id,
                entryId: entry.id,
                identifiers: [...new Set(hits.map((h) => h.identifier))],
              },
            });
          }
        } catch {
          failed += 1;
        }
        scanned += 1;
        if (scanned % PROGRESS_EVERY === 0) await progress();
      }
      cursor = page[page.length - 1].id;
    }
    await prisma.yaraRetroscan.update({
      where: { id },
      data: { scanned, matched, failed, status: 'DONE', finishedAt: new Date() },
    });
  } finally {
    cancelRequested.delete(id);
    await dropFromWorker(key);
  }
}
