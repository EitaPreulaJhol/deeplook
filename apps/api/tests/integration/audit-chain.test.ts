import {
  audit,
  auditHead,
  chainAuditHistory,
  chainHash,
  verifyAuditChain,
} from '../../src/lib/audit';
import { checkAuditChain, resetAuditCheck } from '../../src/lib/audit-check';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { auditCheck } from '../../src/lib/status';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Auditoria com encadeamento de hash (revisao de novembro, item 1.3).
async function main() {
  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string) =>
    prisma.user.create({ data: { email, displayName: email, passwordHash } });
  const ana = await mk('ana@x.io');
  const bia = await mk('bia@x.io');
  const event = (detail: string, actorId: string | null = ana.id) =>
    audit(prisma, null, {
      action: 'USER_SUSPENDED',
      actorId,
      targetUserId: bia.id,
      targetLabel: 'bia@x.io',
      detail,
    });

  // ---- 1. historico anterior ao encadeamento: entra na cadeia na ordem em que foi gravado
  const base = Date.now() - 60_000;
  for (let i = 0; i < 3; i++) {
    await prisma.auditEvent.create({
      data: {
        action: 'LOGIN_FAILED',
        actorId: null,
        targetLabel: `antigo-${i}`,
        createdAt: new Date(base + i * 1000),
      },
    });
  }
  let state = await verifyAuditChain();
  ok(
    'histórico ainda fora da cadeia é contado',
    state.ok && state.events === 0 && state.unchained === 3,
    state,
  );
  ok('subida encadeia o histórico', (await chainAuditHistory()) === 3);
  ok('encadear de novo não faz nada', (await chainAuditHistory()) === 0);
  const old = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
  ok(
    'histórico na ordem da gravação, a partir do 1',
    old.map((e) => e.seq).join() === '1,2,3' &&
      old.map((e) => e.targetLabel).join() === 'antigo-0,antigo-1,antigo-2',
    old.map((e) => [e.seq, e.targetLabel]),
  );

  // ---- 2. gravacao nova continua a cadeia
  await event('primeiro');
  await event('segundo');
  const rows = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
  ok('eventos novos seguem a sequência', rows.map((e) => e.seq).join() === '1,2,3,4,5');
  ok(
    'cada evento aponta para o hash do anterior',
    rows.every((e, i) => (e.prevHash ?? '') === (i ? rows[i - 1].hash : '')),
  );
  ok(
    'o id de quem fez fica guardado fora da chave estrangeira',
    rows[4].actorRef === ana.id && rows[4].targetRef === bia.id,
  );
  state = await verifyAuditChain();
  ok(
    'cadeia íntegra',
    state.ok && state.events === 5 && state.head?.seq === 5 && state.unchained === 0,
    state,
  );
  ok('a ponta é o último evento', (await auditHead())?.hash === rows[4].hash);

  // ---- 3. dentro de uma transacao de quem chama, e desfeita junto com ela
  await prisma.$transaction(async (tx) => {
    await audit(tx, null, { action: 'KEY_CREATED', actorId: ana.id, detail: 'na transação' });
  });
  await prisma
    .$transaction(async (tx) => {
      await audit(tx, null, { action: 'KEY_CREATED', actorId: ana.id, detail: 'desfeito' });
      throw new Error('desfaz');
    })
    .catch(() => undefined);
  await event('depois do desfeito');
  state = await verifyAuditChain();
  ok('transação desfeita não deixa buraco na sequência', state.ok && state.head?.seq === 7, state);

  // ---- 4. gravacoes ao mesmo tempo nao bifurcam a cadeia
  await Promise.all(Array.from({ length: 12 }, (_, i) => event(`ao mesmo tempo ${i}`)));
  state = await verifyAuditChain();
  ok(
    'doze gravações simultâneas: sequência única e íntegra',
    state.ok && state.head?.seq === 19,
    state,
  );
  const tip = state.head!;

  // ---- 5. conta apagada: o evento continua conferindo
  const temp = await mk('temp@x.io');
  await event('feito por quem será apagado', temp.id);
  await prisma.user.delete({ where: { id: temp.id } });
  const orphan = await prisma.auditEvent.findFirstOrThrow({
    where: { detail: 'feito por quem será apagado' },
  });
  ok(
    'conta apagada: a referência some, o id anotado fica',
    orphan.actorId === null && orphan.actorRef === temp.id,
  );
  ok('conta apagada: a cadeia continua íntegra', (await verifyAuditChain()).ok);

  // ---- 6. adulteracao
  const victim = await prisma.auditEvent.findFirstOrThrow({ where: { seq: 4 } });
  await prisma.auditEvent.update({ where: { id: victim.id }, data: { detail: 'reescrito' } });
  state = await verifyAuditChain();
  ok(
    'evento editado: aponta o evento',
    !state.ok && state.problem?.seq === 4 && state.problem.reason.includes('alterado'),
    state,
  );
  // Quem edita e refaz o hash do proprio evento ainda quebra o elo do seguinte.
  await prisma.auditEvent.update({
    where: { id: victim.id },
    data: {
      hash: chainHash({ ...victim, seq: 4, prevHash: victim.prevHash ?? '', detail: 'reescrito' }),
    },
  });
  state = await verifyAuditChain();
  ok(
    'hash refeito no evento editado: o seguinte acusa',
    !state.ok && state.problem?.seq === 5,
    state,
  );
  await prisma.auditEvent.update({
    where: { id: victim.id },
    data: { detail: victim.detail, hash: victim.hash },
  });
  ok('evento restaurado: cadeia íntegra de novo', (await verifyAuditChain()).ok);

  const removed = await prisma.auditEvent.findFirstOrThrow({ where: { seq: 10 } });
  await prisma.auditEvent.delete({ where: { id: removed.id } });
  state = await verifyAuditChain();
  ok(
    'evento apagado do meio: aponta a falta',
    !state.ok && state.problem?.seq === 10 && state.problem.reason.includes('falta'),
    state,
  );
  await prisma.auditEvent.create({ data: removed });
  ok('evento devolvido: cadeia íntegra de novo', (await verifyAuditChain()).ok);

  // ---- 7. ponta cortada: so a ancora de fora pega
  resetAuditCheck();
  const first = await checkAuditChain();
  ok('conferência periódica guarda a ponta', first.ok && first.head?.seq === 20, first);
  ok(
    'status: cadeia íntegra',
    auditCheck().level === 'ok' && auditCheck().summary === 'cadeia íntegra',
    auditCheck(),
  );
  const last = await prisma.auditEvent.findFirstOrThrow({ where: { seq: 20 } });
  await prisma.auditEvent.delete({ where: { id: last.id } });
  const alone = await verifyAuditChain();
  ok(
    'ponta cortada: a cadeia sozinha continua coerente (limite conhecido)',
    alone.ok && alone.head?.seq === 19,
  );
  const cut = await checkAuditChain();
  ok(
    'ponta cortada: a conferência periódica acusa pela ponta que já viu',
    !cut.ok && cut.problem?.seq === 20,
    cut,
  );
  ok(
    'status: erro com o motivo',
    auditCheck().level === 'error' && auditCheck().summary.includes('cadeia quebrada'),
    auditCheck(),
  );
  ok(
    'ponta de um backup: confere o evento anotado',
    (await verifyAuditChain({ expect: tip })).ok &&
      !(await verifyAuditChain({ expect: { seq: tip.seq, hash: 'x'.repeat(64) } })).ok,
  );

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
