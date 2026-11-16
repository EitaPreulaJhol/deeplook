import { Prisma } from '../generated/prisma/client';
import { log, reason } from './log';
import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';
import type { SigmaRule } from './sigma';
import {
  isTeamRule,
  matchSigma,
  reloadSigmaConfig,
  safeMatch,
  sigmaDisabled,
  sigmaRule,
  sigmaRuleUrl,
  sigmaVersion,
  TEAM_PREFIX,
} from './sigma-rules';
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

/** Roda `fn` com o ambiente travado: uma avaliacao por ambiente de cada vez. */
function withSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const running = busy.get(sessionId);
  if (running) return running.catch(() => undefined).then(() => withSession(sessionId, fn));
  const job = fn().finally(() => busy.delete(sessionId));
  busy.set(sessionId, job as Promise<unknown> as Promise<number>);
  return job;
}

/** Avalia os eventos ainda nao avaliados do ambiente. Devolve quantas deteccoes novas. */
export function evaluateSigma(sessionId: string): Promise<number> {
  return withSession(sessionId, () => evaluate(sessionId));
}

type EventRow = { id: string; eventId: number; time: Date; data: Prisma.JsonValue };
type Acc = { rule: SigmaRule; guid: string; count: number; first: EventRow; last: Date };

/** Junta as deteccoes de um lote por regra e processo. */
async function collect(
  rows: EventRow[],
  rulesFor: (event: { eventId: number; data: Record<string, string | null> }) => SigmaRule[],
): Promise<Map<string, Acc>> {
  const found = new Map<string, Acc>();
  for (const [i, row] of rows.entries()) {
    // ~1 ms por evento de processo (1600 regras): a cada 50, a API volta a atender pedidos.
    if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
    const data = row.data as Record<string, string | null>;
    for (const rule of rulesFor({ eventId: row.eventId, data })) {
      const guid = guidOf(data);
      const key = `${rule.id}\u0000${guid}`;
      const acc = found.get(key);
      if (acc) {
        acc.count += 1;
        if (row.time > acc.last) acc.last = row.time;
      } else {
        found.set(key, { rule, guid, count: 1, first: row, last: row.time });
      }
    }
  }
  return found;
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
    const found = await collect(rows, matchSigma);
    const writes = await hitWrites(sessionId, found);
    created += writes.created;
    writes.list.push(
      prisma.sandboxSysmonEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { sigmaChecked: true },
      }),
    );
    await prisma.$transaction(writes.list);
    if (rows.length < BATCH) return created;
  }
}

/** As escritas (criar ou somar) das deteccoes de um lote, e quantas sao novas. */
async function hitWrites(
  sessionId: string,
  found: Map<string, Acc>,
): Promise<{ list: Prisma.PrismaPromise<unknown>[]; created: number }> {
  let created = 0;
  {
    const existing = found.size
      ? await prisma.sandboxSigmaHit.findMany({
          where: {
            sessionId,
            ruleId: { in: [...new Set([...found.values()].map((a) => a.rule.id))] },
          },
          select: { id: true, ruleId: true, processGuid: true, firstAt: true, lastAt: true },
        })
      : [];
    const byKey = new Map(existing.map((h) => [`${h.ruleId}\u0000${h.processGuid}`, h]));
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, acc] of found) {
      const { rule } = acc;
      // Desligada ou excluida enquanto o lote era avaliado: a deteccao nao entra.
      if (!activeRule(rule.id)) continue;
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
    return { list: writes, created };
  }
}

/** Apaga as deteccoes do ambiente e avalia todos os eventos de novo. */
export function reevaluateSigma(sessionId: string): Promise<number> {
  return withSession(sessionId, async () => {
    await prisma.$transaction([
      prisma.sandboxSigmaHit.deleteMany({ where: { sessionId } }),
      prisma.sandboxSysmonEvent.updateMany({ where: { sessionId }, data: { sigmaChecked: false } }),
    ]);
    return evaluate(sessionId);
  });
}

// ------------------------------------------------------- uma regra so (plans/caca-e-formatos, item 1)

/** A regra, se esta valendo agora (ligada, e a da equipe ainda existe). */
function activeRule(ruleId: string): SigmaRule | undefined {
  const rule = sigmaRule(ruleId);
  return rule && !sigmaDisabled().has(ruleId) ? rule : undefined;
}

/** Regras esperando para serem refeitas sobre os eventos guardados, na ordem. */
const retroQueue: string[] = [];
let retroCurrent: string | null = null;
let retroLoop: Promise<void> | null = null;

/** O que falta reavaliar (a regra em andamento e a fila). */
export function sigmaRetroState(): { current: string | null; queued: string[] } {
  return { current: retroCurrent, queued: [...retroQueue] };
}

/** Termina quando a fila esvazia (testes). */
export async function sigmaRetroIdle(): Promise<void> {
  while (retroLoop) await retroLoop;
}

/**
 * Uma regra mudou (criada, editada, ligada, desligada ou excluida): rele a configuracao, tira as
 * deteccoes dela e, se ela vale agora, poe na fila para refazer sobre os eventos ja avaliados. Os
 * eventos ainda nao avaliados passam por ela na coleta normal.
 */
export async function sigmaRuleChanged(ruleId: string): Promise<void> {
  await reloadSigmaConfig();
  if (!activeRule(ruleId)) {
    const i = retroQueue.indexOf(ruleId);
    if (i >= 0) retroQueue.splice(i, 1);
    await prisma.sandboxSigmaHit.deleteMany({ where: { ruleId } });
    return;
  }
  if (!retroQueue.includes(ruleId)) retroQueue.push(ruleId);
  retroLoop ??= (async () => {
    try {
      for (let next = retroQueue.shift(); next; next = retroQueue.shift()) {
        retroCurrent = next;
        await retroRule(next).catch((err: unknown) =>
          log.warn(`[sigma] reavaliação da regra ${next} falhou: ${reason(err)}`),
        );
      }
    } finally {
      retroCurrent = null;
      retroLoop = null;
    }
  })();
}

/**
 * Refaz as deteccoes de uma regra em cada ambiente, com o ambiente travado (a coleta nao avalia ao
 * mesmo tempo): apaga as dela e passa a regra nos eventos ja avaliados. Nada conta duas vezes: o
 * que nao foi avaliado ainda passa pela regra na coleta.
 */
async function retroRule(ruleId: string): Promise<void> {
  const sessions = await prisma.sandboxSysmonEvent.findMany({
    where: { sigmaChecked: true },
    distinct: ['sessionId'],
    select: { sessionId: true },
  });
  for (const { sessionId } of sessions) {
    await withSession(sessionId, async () => {
      const rule = activeRule(ruleId);
      if (!rule) return;
      await prisma.sandboxSigmaHit.deleteMany({ where: { sessionId, ruleId } });
      let cursor: string | undefined;
      for (;;) {
        const rows: EventRow[] = await prisma.sandboxSysmonEvent.findMany({
          where: {
            sessionId,
            sigmaChecked: true,
            ...(rule.eventIds.length && { eventId: { in: rule.eventIds } }),
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor && { cursor: { id: cursor }, skip: 1 }),
          select: { id: true, eventId: true, time: true, data: true },
        });
        if (!rows.length) break;
        cursor = rows[rows.length - 1].id;
        const found = await collect(rows, (e) => (safeMatch(rule, e) ? [rule] : []));
        if (found.size) await prisma.$transaction((await hitWrites(sessionId, found)).list);
        if (rows.length < BATCH) break;
      }
    });
  }
  // Sem tocar no updatedAt (o "editada em" da tela), e so se ela nao voltou para a fila.
  if (isTeamRule(ruleId) && !retroQueue.includes(ruleId)) {
    await prisma.$executeRaw`UPDATE "SigmaRule" SET "evaluatedAt" = now() WHERE "id" = ${ruleId.slice(TEAM_PREFIX.length)}`;
  }
}

/**
 * Na subida: se o conjunto de regras mudou, apaga as deteccoes e marca os eventos para avaliar de
 * novo; depois avalia, um ambiente por vez, os que tem eventos pendentes (inclusive os encerrados).
 */
export async function startSigma(): Promise<void> {
  await reloadSigmaConfig();
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
    // Regras da equipe cuja reavaliacao nao terminou (a API parou no meio).
    const unfinished = await prisma.sigmaRule.findMany({
      where: { enabled: true, evaluatedAt: null },
      select: { id: true },
    });
    for (const { id } of unfinished) await sigmaRuleChanged(`${TEAM_PREFIX}${id}`);
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
  /** Regra da equipe: o id do banco (a tela leva ao editor, nao ao GitHub). */
  teamRuleId: string | null;
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
        teamRuleId: isTeamRule(h.ruleId) ? h.ruleId.slice(TEAM_PREFIX.length) : null,
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
