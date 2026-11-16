import { Prisma } from '../generated/prisma/client';
import { log, reason } from './log';
import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';
import { matchSigma, sigmaRule, sigmaRuleUrl, sigmaVersion } from './sigma-rules';
import { apiTime, sysmonOffset } from './sysmon-store';

/**
 * As regras Sigma sobre os eventos guardados do Sysmon (plans/novas-analises, item 1). Cada coleta
 * avalia so os eventos novos (SandboxSysmonEvent.sigmaChecked); as deteccoes ficam em
 * SandboxSigmaHit, uma por regra e processo, com a contagem e o primeiro evento. Quando o conjunto
 * de regras muda (outra release vendorizada), tudo e avaliado de novo, em segundo plano.
 */

/** Eventos por lote de avaliacao. */
const BATCH = 1000;
/** Campos do evento guardados na deteccao (o resto fica na linha do tempo). */
const EVENT_TEXT_MAX = 1000;

const SETTING = 'sigmaRulesVersion';

/** Uma avaliacao por ambiente de cada vez (a coleta e o "avaliar de novo" podem se cruzar). */
const busy = new Map<string, Promise<number>>();

/** O processo do evento: ProcessGuid, ou o de origem no acesso a processo e na thread remota. */
const guidOf = (d: Record<string, string | null>) =>
  d.ProcessGuid ?? d.SourceProcessGuid ?? d.SourceProcessGUID ?? '';
const imageOf = (d: Record<string, string | null>) => d.Image ?? d.SourceImage ?? null;

/** Avalia os eventos ainda nao avaliados do ambiente. Devolve quantas deteccoes novas. */
export function evaluateSigma(sessionId: string): Promise<number> {
  const running = busy.get(sessionId);
  if (running) return running.then(() => evaluateSigma(sessionId));
  const job = evaluate(sessionId).finally(() => busy.delete(sessionId));
  busy.set(sessionId, job);
  return job;
}

async function evaluate(sessionId: string): Promise<number> {
  let created = 0;
  for (;;) {
    const rows = await prisma.sandboxSysmonEvent.findMany({
      where: { sessionId, sigmaChecked: false },
      orderBy: [{ time: 'asc' }, { recordId: 'asc' }],
      take: BATCH,
      select: { id: true, eventId: true, time: true, data: true },
    });
    if (!rows.length) return created;
    type Acc = {
      ruleId: string;
      guid: string;
      count: number;
      first: (typeof rows)[number];
      last: Date;
    };
    const found = new Map<string, Acc>();
    for (const [i, row] of rows.entries()) {
      // ~1 ms por evento de processo (1600 regras): a cada 50, a API volta a atender pedidos.
      if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
      const data = row.data as Record<string, string | null>;
      for (const rule of matchSigma({ eventId: row.eventId, data })) {
        const guid = guidOf(data);
        const key = `${rule.id}\u0000${guid}`;
        const acc = found.get(key);
        if (acc) {
          acc.count += 1;
          if (row.time > acc.last) acc.last = row.time;
        } else {
          found.set(key, { ruleId: rule.id, guid, count: 1, first: row, last: row.time });
        }
      }
    }
    const existing = found.size
      ? await prisma.sandboxSigmaHit.findMany({
          where: {
            sessionId,
            ruleId: { in: [...new Set([...found.values()].map((a) => a.ruleId))] },
          },
          select: { id: true, ruleId: true, processGuid: true, firstAt: true, lastAt: true },
        })
      : [];
    const byKey = new Map(existing.map((h) => [`${h.ruleId}\u0000${h.processGuid}`, h]));
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, acc] of found) {
      const rule = sigmaRule(acc.ruleId)!;
      const data = acc.first.data as Record<string, string | null>;
      const event = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          typeof v === 'string' ? v.slice(0, EVENT_TEXT_MAX) : v,
        ]),
      );
      const before = byKey.get(key);
      if (before) {
        writes.push(
          prisma.sandboxSigmaHit.update({
            where: { id: before.id },
            data: {
              count: { increment: acc.count },
              lastAt: acc.last > before.lastAt ? acc.last : before.lastAt,
              // Um evento mais antigo (leitura fora de ordem) passa a ser o exemplo.
              ...(acc.first.time < before.firstAt && {
                firstAt: acc.first.time,
                eventId: acc.first.eventId,
                event: event as Prisma.InputJsonValue,
              }),
            },
          }),
        );
      } else {
        created += 1;
        writes.push(
          prisma.sandboxSigmaHit.create({
            data: {
              sessionId,
              ruleId: rule.id,
              title: rule.title,
              level: rule.level,
              techniques: rule.techniques,
              processGuid: acc.guid,
              image: imageOf(data),
              eventId: acc.first.eventId,
              event: event as Prisma.InputJsonValue,
              count: acc.count,
              firstAt: acc.first.time,
              lastAt: acc.last,
            },
          }),
        );
      }
    }
    writes.push(
      prisma.sandboxSysmonEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { sigmaChecked: true },
      }),
    );
    await prisma.$transaction(writes);
    if (rows.length < BATCH) return created;
  }
}

/** Apaga as deteccoes do ambiente e avalia todos os eventos de novo. */
export async function reevaluateSigma(sessionId: string): Promise<number> {
  await busy.get(sessionId)?.catch(() => undefined);
  await prisma.$transaction([
    prisma.sandboxSigmaHit.deleteMany({ where: { sessionId } }),
    prisma.sandboxSysmonEvent.updateMany({ where: { sessionId }, data: { sigmaChecked: false } }),
  ]);
  return evaluateSigma(sessionId);
}

/**
 * Na subida: se o conjunto de regras mudou, apaga as deteccoes e marca os eventos para avaliar de
 * novo; depois avalia, um ambiente por vez, os que tem eventos pendentes (inclusive os encerrados).
 */
export async function startSigma(): Promise<void> {
  const version = sigmaVersion();
  const stored = (await readSetting(SETTING)) as { version?: string } | null;
  if (stored?.version !== version) {
    await prisma.$transaction([
      prisma.sandboxSigmaHit.deleteMany({}),
      prisma.sandboxSysmonEvent.updateMany({
        where: { sigmaChecked: true },
        data: { sigmaChecked: false },
      }),
    ]);
    await writeSetting(SETTING, { version });
  }
  void (async () => {
    const pending = await prisma.sandboxSysmonEvent.findMany({
      where: { sigmaChecked: false },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    for (const { sessionId } of pending) {
      await evaluateSigma(sessionId).catch((err: unknown) =>
        log.warn(`[sigma] avaliação do ambiente ${sessionId} falhou: ${reason(err)}`),
      );
    }
  })().catch((err: unknown) => log.warn(`[sigma] avaliação na subida falhou: ${reason(err)}`));
}

// ------------------------------------------------------------------ leitura

export const SIGMA_LEVEL_ORDER = ['critical', 'high', 'medium', 'low', 'informational'];

export interface SigmaHitView {
  ruleId: string;
  title: string;
  level: string;
  techniques: string[];
  image: string | null;
  pid: number | null;
  /** O processo e da amostra (ou descende dela). */
  sample: boolean;
  eventId: number;
  event: Record<string, string | null>;
  count: number;
  firstAt: string;
  lastAt: string;
  description: string | null;
  author: string | null;
  falsepositives: string[];
  references: string[];
  url: string | null;
}

/** As deteccoes do ambiente, do nivel mais alto para o mais baixo, com os dados da regra. */
export async function sigmaHitsView(sessionId: string, tree: Set<string>): Promise<SigmaHitView[]> {
  const [hits, offsetMs] = await Promise.all([
    prisma.sandboxSigmaHit.findMany({ where: { sessionId } }),
    sysmonOffset(sessionId),
  ]);
  const rank = (level: string) => {
    const i = SIGMA_LEVEL_ORDER.indexOf(level);
    return i < 0 ? SIGMA_LEVEL_ORDER.length : i;
  };
  return hits
    .map((h): SigmaHitView => {
      const rule = sigmaRule(h.ruleId);
      const event = h.event as Record<string, string | null>;
      const pid = Number(event.ProcessId ?? event.SourceProcessId);
      return {
        ruleId: h.ruleId,
        title: h.title,
        level: h.level,
        techniques: h.techniques,
        image: h.image,
        pid: Number.isInteger(pid) ? pid : null,
        sample: Boolean(h.processGuid && tree.has(h.processGuid)),
        eventId: h.eventId,
        event,
        count: h.count,
        firstAt: apiTime(h.firstAt, offsetMs),
        lastAt: apiTime(h.lastAt, offsetMs),
        description: rule?.description ?? null,
        author: rule?.author ?? null,
        falsepositives: rule?.falsepositives ?? [],
        references: rule?.references ?? [],
        url: rule ? sigmaRuleUrl(rule) : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.sample) - Number(a.sample) ||
        rank(a.level) - rank(b.level) ||
        b.count - a.count ||
        a.title.localeCompare(b.title),
    );
}
