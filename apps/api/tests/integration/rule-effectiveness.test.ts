import { buildApp } from '../../src/app';
import type { Verdict } from '../../src/generated/prisma/client';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Plano pos-revisao, item 2.3: em quantas amostras cada regra disparou nos ultimos 90 dias e
// quantas delas terminaram limpas, nas listas de regras YARA e de triagem.
async function main() {
  const app = await buildApp();
  await app.ready();

  const ana = await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'Ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const cookie = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  const rule = (name: string) =>
    prisma.yaraRule.create({
      data: { name, source: `rule ${name.replace(/\W/g, '_')} { condition: true }` },
    });
  await rule('Emotet');
  await rule('Ruidosa');
  await rule('Nunca');
  const old = new Date(Date.now() - 200 * 86_400_000);
  let n = 0;
  const sample = async (
    verdict: Verdict,
    hits: string[],
    options: { deleted?: boolean; scannedAt?: Date } = {},
  ) => {
    n += 1;
    return prisma.entry.create({
      data: {
        type: 'FILE',
        title: `amostra-${n}`,
        ownerId: ana.id,
        verdict,
        deletedAt: options.deleted ? new Date() : null,
        yara: {
          create: {
            status: hits.length ? 'MATCHED' : 'CLEAN',
            matches: hits.map((h) => ({ rule: h, identifier: h, tags: [], matches: 1 })),
            scannedAt: options.scannedAt ?? new Date(),
          },
        },
      },
    });
  };
  const a = await sample('MALICIOUS', ['Emotet', 'Ruidosa']);
  const b = await sample('CLEAN', ['Ruidosa']);
  const c = await sample('CLEAN', ['Ruidosa']);
  await sample('CLEAN', ['Ruidosa'], { deleted: true });
  await sample('CLEAN', ['Emotet'], { scannedAt: old });

  // 1. YARA.
  type Listed = { name: string; effectiveness: { fired: number; clean: number } };
  const yara = (await get('/api/yara/rules')).json<{
    rules: Listed[];
    effectivenessDays: number;
  }>();
  const of = (name: string) => yara.rules.find((r) => r.name === name)?.effectiveness;
  ok('YARA: período de 90 dias', yara.effectivenessDays === 90, yara.effectivenessDays);
  ok(
    'YARA: Emotet disparou numa maliciosa (a varredura antiga fica de fora)',
    of('Emotet')?.fired === 1 && of('Emotet')?.clean === 0,
    of('Emotet'),
  );
  ok(
    'YARA: Ruidosa em 3, duas limpas (a da lixeira fica de fora)',
    of('Ruidosa')?.fired === 3 && of('Ruidosa')?.clean === 2,
    of('Ruidosa'),
  );
  ok(
    'YARA: a que nunca disparou aparece com zero',
    of('Nunca')?.fired === 0 && of('Nunca')?.clean === 0,
    of('Nunca'),
  );

  // 2. Triagem: evento novo (com o id) e antigo (so o nome); renomear nao perde os novos.
  const triage = await prisma.triageRule.create({
    data: { name: 'Macro', condition: 'MACRO', tags: ['macro'] },
  });
  const quiet = await prisma.triageRule.create({
    data: { name: 'Silenciosa', condition: 'MACRO', tags: ['x'] },
  });
  await prisma.entryEvent.createMany({
    data: [
      {
        entryId: a.id,
        type: 'TRIAGE_RULE',
        fromValue: triage.id,
        toValue: 'Macro',
        detail: 'tags macro',
      },
      { entryId: b.id, type: 'TRIAGE_RULE', toValue: 'Macro', detail: 'tags macro' },
      {
        entryId: c.id,
        type: 'TRIAGE_RULE',
        fromValue: triage.id,
        toValue: 'Macro',
        detail: 'tags macro',
      },
    ],
  });
  await prisma.triageRule.update({ where: { id: triage.id }, data: { name: 'Macro (renomeada)' } });
  type TriageListed = { id: string; effectiveness: { fired: number; clean: number } };
  const rules = (await get('/api/triage-rules')).json<{ rules: TriageListed[] }>().rules;
  const t = rules.find((r) => r.id === triage.id)?.effectiveness;
  ok(
    'triagem: renomeada, conta os eventos com o id (o antigo, só com o nome, fica de fora)',
    t?.fired === 2 && t?.clean === 1,
    t,
  );
  ok(
    'triagem: a que nunca disparou aparece com zero',
    rules.find((r) => r.id === quiet.id)?.effectiveness.fired === 0,
  );
  await prisma.triageRule.update({ where: { id: triage.id }, data: { name: 'Macro' } });
  const back = (await get('/api/triage-rules')).json<{ rules: TriageListed[] }>().rules;
  ok(
    'triagem: com o nome de antes, o evento antigo volta a contar',
    back.find((r) => r.id === triage.id)?.effectiveness.fired === 3,
    back.find((r) => r.id === triage.id),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
