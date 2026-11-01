import { prisma } from '../../src/lib/prisma';
import {
  compileRuleSets,
  scanBuffer,
  scanWithYara,
  yaraScanEntry,
  yaraWorkerRestarts,
} from '../../src/lib/yara';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const owner = await prisma.user.create({
    data: { email: 'a@x.io', displayName: 'a', role: 'ANALYST', passwordHash: 'x' },
  });
  const entry = (title: string) =>
    prisma.entry.create({ data: { type: 'FILE', title, ownerId: owner.id } });
  const content = Buffer.from('xxxx MARCA-PUBLICA yyyy');

  // 1. Regra privada e auxiliar: nao vira deteccao.
  const set = compileRuleSets([
    {
      id: 'a',
      name: 'Conjunto',
      source: `private rule auxiliar { condition: true }
rule publica { strings: $a = "MARCA-PUBLICA" condition: auxiliar and $a }
rule nao_casa { strings: $a = "NUNCA" condition: auxiliar and $a }`,
    },
  ]);
  const hits = scanBuffer(set, content);
  ok('só a pública é detecção', hits.map((h) => h.identifier).join() === 'publica', hits);
  ok('a privada é usada', scanBuffer(set, Buffer.from('nada')).length === 0);
  set.rules.free();

  // 1b. Conjunto que deixou de compilar nao derruba os outros.
  const mixed = compileRuleSets([
    { id: 'ruim', name: 'Ruim', source: 'rule ruim { condition: nao_existe }' },
    { id: 'bom', name: 'Bom', source: 'rule bom { condition: true }' },
  ]);
  ok('conjunto quebrado fica de fora', mixed.count === 1, mixed.count);
  ok(
    'os outros seguem',
    scanBuffer(mixed, content)
      .map((h) => h.identifier)
      .join() === 'bom',
  );
  mixed.rules.free();
  await prisma.yaraRule.create({
    data: { name: 'Quebrada', source: 'rule quebrada { condition: nao_existe }' },
  });

  // 2. Privada sozinha: amostra limpa, sem regra de triagem.
  await prisma.yaraRule.create({
    data: { name: 'So privada', source: 'private rule sempre { condition: true }' },
  });
  await prisma.triageRule.create({
    data: { name: 'Qualquer YARA', condition: 'YARA', tags: ['yara-casou'] },
  });
  const clean = await entry('limpa');
  await yaraScanEntry(clean.id, Buffer.from('qualquer coisa'));
  const scan = await prisma.yaraScan.findUnique({ where: { entryId: clean.id } });
  ok('privada sozinha: limpa', scan?.status === 'CLEAN', scan);
  const cleanTags = await prisma.entry.findUnique({
    where: { id: clean.id },
    include: { tags: true },
  });
  ok('privada sozinha: sem triagem', cleanTags?.tags.length === 0, cleanTags?.tags);

  // 3. Publica de verdade continua detectando e acionando a triagem.
  await prisma.yaraRule.create({
    data: {
      name: 'Publica',
      source: 'rule publica { strings: $a = "MARCA-PUBLICA" condition: $a }',
    },
  });
  const dirty = await entry('marcada');
  await yaraScanEntry(dirty.id, content);
  const found = await prisma.yaraScan.findUnique({ where: { entryId: dirty.id } });
  ok('pública: marcada', found?.status === 'MATCHED', found);
  const dirtyTags = await prisma.entry.findUnique({
    where: { id: dirty.id },
    include: { tags: true },
  });
  ok('pública: aciona a triagem', dirtyTags?.tags[0]?.name === 'yara-casou', dirtyTags?.tags);

  // 4. Limite do motor (item 148): a thread e trocada antes de quebrar, sem falhar.
  await prisma.yaraRule.deleteMany({});
  await prisma.yaraRule.create({
    data: { name: 'Volume', source: 'rule volume { strings: $a = "MARCA" condition: $a }' },
  });
  const before = yaraWorkerRestarts();
  let failed = 0;
  // 18 mil chamadas: passa do ponto em que o motor quebraria (cerca de 16.270).
  for (let i = 0; i < 3_000; i++) {
    const { hits } = await scanWithYara(Buffer.from('xx MARCA'), {
      filename: `a${i}.exe`,
      filepath: '',
      extension: '.exe',
      filetype: 'EXE',
      owner: '',
    });
    if (hits.length !== 1) failed += 1;
  }
  ok('3 mil varreduras sem falha', failed === 0, failed);
  ok('thread reciclada', yaraWorkerRestarts() > before, yaraWorkerRestarts());

  // 5. Arquivo grande: thread nova depois dele, para devolver a memoria (item 149).
  const beforeBig = yaraWorkerRestarts();
  const big = Buffer.alloc(101 * 1024 * 1024);
  big.write('MARCA', 50 * 1024 * 1024);
  const copyCheck = big[0];
  ok('arquivo grande detecta', (await scanWithYara(big)).hits.length === 1);
  ok('thread nova depois do grande', yaraWorkerRestarts() === beforeBig + 1);
  ok('o original continua utilizável', big.length > 0 && big[0] === copyCheck);
  ok('segue varrendo', (await scanWithYara(Buffer.from('MARCA'))).hits.length === 1);

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
