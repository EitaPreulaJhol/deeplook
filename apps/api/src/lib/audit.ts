import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { AuditAction } from '../generated/prisma/client';
import { advisoryLock, type Db, prisma, type Tx } from './prisma';

export interface AuditInput {
  action: AuditAction;
  /** Quem fez; null = anonimo (ex.: login recusado). */
  actorId: string | null;
  targetUserId?: string | null;
  /** Rotulo do alvo no momento (e-mail, codigo da chave, nome do modelo). */
  targetLabel?: string | null;
  /** Complemento legivel ("USER → ANALYST"). NUNCA senhas. */
  detail?: string | null;
}

/**
 * Encadeamento de hash (revisao de novembro, item 1.3). Cada evento guarda o numero de
 * sequencia, o hash do anterior e o proprio hash, calculado sobre os campos que nao mudam
 * depois de gravados. Editar um evento quebra o hash dele; apagar um do meio quebra a sequencia
 * e o hash anterior do seguinte. `verifyAuditChain` percorre a cadeia e aponta o primeiro
 * problema.
 *
 * O que NAO cobre: quem controla o banco pode reescrever a cadeia inteira, ou cortar a ponta
 * (os ultimos eventos), e ela continua coerente. Para isso existe a ancora de fora: a ponta
 * (sequencia e hash) vai no manifesto de cada backup e no log da conferencia periodica, e
 * `verifyAuditChain({ expect })` confere a cadeia contra uma ponta conhecida.
 */

/** Uma gravacao por vez: sem isto, dois eventos leriam a mesma ponta e bifurcariam a cadeia. */
const AUDIT_LOCK = 880_003;
const PAGE = 500;

export type ChainFields = {
  seq: number;
  prevHash: string;
  action: string;
  actorRef: string | null;
  targetRef: string | null;
  targetLabel: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: Date;
};

/** Hash do evento: SHA-256 de uma lista JSON, na ordem fixa abaixo. */
export function chainHash(f: ChainFields): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        f.seq,
        f.prevHash,
        f.action,
        f.actorRef,
        f.targetRef,
        f.targetLabel,
        f.detail,
        f.ip,
        f.createdAt.toISOString(),
      ]),
    )
    .digest('hex');
}

/** O cliente raiz abre transacao; o cliente de dentro de uma transacao nao tem o metodo. */
const isRoot = (db: Db): db is typeof prisma =>
  typeof (db as { $transaction?: unknown }).$transaction === 'function';

async function head(tx: Tx): Promise<{ seq: number; hash: string }> {
  const last = await tx.auditEvent.findFirst({
    where: { seq: { not: null } },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });
  return { seq: last?.seq ?? 0, hash: last?.hash ?? '' };
}

/**
 * Encadeia os eventos ainda sem sequencia (o historico anterior a este item), na ordem em que
 * foram gravados. Chamar com a trava da auditoria ja tomada.
 */
async function chainPending(tx: Tx): Promise<number> {
  let done = 0;
  for (;;) {
    const pending = await tx.auditEvent.findMany({
      where: { seq: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
    });
    if (!pending.length) return done;
    let { seq, hash } = await head(tx);
    for (const row of pending) {
      const fields: ChainFields = {
        seq: seq + 1,
        prevHash: hash,
        action: row.action,
        // No historico, o que restou: se a conta ja foi apagada, o id se perdeu.
        actorRef: row.actorId,
        targetRef: row.targetUserId,
        targetLabel: row.targetLabel,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.createdAt,
      };
      hash = chainHash(fields);
      seq = fields.seq;
      await tx.auditEvent.update({
        where: { id: row.id },
        data: {
          seq,
          prevHash: fields.prevHash,
          hash,
          actorRef: fields.actorRef,
          targetRef: fields.targetRef,
        },
      });
      done += 1;
    }
  }
}

async function append(tx: Tx, req: FastifyRequest | null, input: AuditInput): Promise<void> {
  // A trava vale ate o fim da transacao de quem chamou: a ponta lida aqui continua sendo a
  // ponta quando este evento for confirmado.
  await advisoryLock(tx, AUDIT_LOCK);
  await chainPending(tx);
  const last = await head(tx);
  const fields: ChainFields = {
    seq: last.seq + 1,
    prevHash: last.hash,
    action: input.action,
    actorRef: input.actorId,
    targetRef: input.targetUserId ?? null,
    targetLabel: input.targetLabel?.slice(0, 200) ?? null,
    detail: input.detail?.slice(0, 500) ?? null,
    ip: req?.ip ?? null,
    // Milissegundos, como a coluna guarda: o hash e refeito a partir do que volta do banco.
    createdAt: new Date(),
  };
  await tx.auditEvent.create({
    data: {
      action: input.action,
      actorId: input.actorId,
      targetUserId: input.targetUserId ?? null,
      targetLabel: fields.targetLabel,
      detail: fields.detail,
      ip: fields.ip,
      createdAt: fields.createdAt,
      seq: fields.seq,
      prevHash: fields.prevHash,
      hash: chainHash(fields),
      actorRef: fields.actorRef,
      targetRef: fields.targetRef,
    },
  });
}

/**
 * Registro de auditoria administrativa (aba Auditoria). Grave na mesma
 * transacao da acao quando houver uma. O IP vem do proxy (trustProxy).
 */
export async function audit(db: Db, req: FastifyRequest | null, input: AuditInput): Promise<void> {
  // Fora de transacao a trava duraria so um comando: abre uma para o evento.
  if (isRoot(db)) await db.$transaction((tx) => append(tx, req, input));
  else await append(db, req, input);
}

/** Encadeia o historico pendente (na subida); devolve quantos eventos entraram na cadeia. */
export function chainAuditHistory(): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      await advisoryLock(tx, AUDIT_LOCK);
      return chainPending(tx);
    },
    { timeout: 10 * 60_000, maxWait: 60_000 },
  );
}

export type AuditChainState = {
  ok: boolean;
  /** Eventos conferidos (ate o problema, se houver). */
  events: number;
  /** Eventos ainda fora da cadeia (historico a encadear). */
  unchained: number;
  /** A ponta: o ultimo evento da cadeia. */
  head: { seq: number; hash: string } | null;
  /** O primeiro problema encontrado. */
  problem: { seq: number | null; reason: string } | null;
  checkedAt: string;
};

/**
 * Percorre a cadeia do inicio ao fim e aponta o primeiro problema. Com `expect` (a ponta de um
 * backup, ou a anotada no log), confere tambem que aquele evento continua la com o mesmo hash:
 * e o que pega a cadeia reescrita ou com a ponta cortada.
 */
export async function verifyAuditChain(
  options: { db?: Db; expect?: { seq: number; hash: string } | null } = {},
): Promise<AuditChainState> {
  const db = options.db ?? prisma;
  const state: AuditChainState = {
    ok: true,
    events: 0,
    unchained: await db.auditEvent.count({ where: { seq: null } }),
    head: null,
    problem: null,
    checkedAt: new Date().toISOString(),
  };
  const fail = (seq: number | null, reason: string): AuditChainState => ({
    ...state,
    ok: false,
    problem: { seq, reason },
  });
  let prev = { seq: 0, hash: '' };
  let expected: string | null = null;
  for (;;) {
    const page = await db.auditEvent.findMany({
      where: { seq: { gt: prev.seq } },
      orderBy: { seq: 'asc' },
      take: PAGE,
    });
    if (!page.length) break;
    for (const row of page) {
      const seq = row.seq!;
      if (seq !== prev.seq + 1) {
        return fail(prev.seq + 1, `falta o evento ${prev.seq + 1} (o seguinte é o ${seq})`);
      }
      if ((row.prevHash ?? '') !== prev.hash) {
        return fail(seq, `o evento ${seq} não aponta para o anterior`);
      }
      const hash = chainHash({
        seq,
        prevHash: prev.hash,
        action: row.action,
        actorRef: row.actorRef,
        targetRef: row.targetRef,
        targetLabel: row.targetLabel,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.createdAt,
      });
      if (hash !== row.hash) return fail(seq, `o evento ${seq} foi alterado depois de gravado`);
      prev = { seq, hash };
      state.events += 1;
      state.head = prev;
      if (options.expect?.seq === seq) expected = hash;
    }
  }
  if (options.expect && options.expect.seq > 0) {
    if (expected === null) {
      return fail(
        options.expect.seq,
        `a cadeia termina no evento ${prev.seq}, antes do evento ${options.expect.seq} conhecido`,
      );
    }
    if (expected !== options.expect.hash) {
      return fail(options.expect.seq, `o evento ${options.expect.seq} não é o que foi anotado`);
    }
  }
  return state;
}

/** A ponta da cadeia agora (para o manifesto do backup). */
export async function auditHead(): Promise<{ seq: number; hash: string } | null> {
  const last = await prisma.auditEvent.findFirst({
    where: { seq: { not: null } },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });
  return last?.hash ? { seq: last.seq!, hash: last.hash } : null;
}
