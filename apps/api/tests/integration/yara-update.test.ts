import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { systemStatus } from '../../src/lib/status';
import { scanContextOf, scanWithYara } from '../../src/lib/yara';
import { installYaraPacks, loadPackState, packRulesDir, yaraPacks } from '../../src/lib/yara-packs';
import { checkYaraPack, configurePackSource, runDuePackChecks } from '../../src/lib/yara-update';
import { ZipWriter } from '../../src/lib/zip-writer';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const PACK = 'bartblaze';
const pack = yaraPacks().find((p) => p.id === PACK)!;
const LICENSE = readFileSync(join(packRulesDir(PACK), 'LICENSE'));

/** Monta o ZIP como o GitHub: tudo dentro de "<repo>-<commit>/". */
async function makeZip(files: Record<string, string>, license: Buffer | null = LICENSE) {
  const path = join(process.env.TEST_TMP!, `pack-${Date.now()}-${Math.random()}.zip`);
  const z = await ZipWriter.create(path);
  const add = async (name: string, body: Buffer) =>
    z.add(`Yara-rules-abc/${name}`, body.length, body);
  if (license) await add('LICENSE', license);
  for (const [name, text] of Object.entries(files)) {
    await add(`${pack.folder}/${name}`, Buffer.from(text));
  }
  await add('README.md', Buffer.from('nao e regra'));
  await z.finish();
  const out = readFileSync(path);
  rmSync(path);
  return out;
}

/** Os arquivos atuais do pacote, de onde cada versao de teste parte. */
const baseFiles = () =>
  Object.fromEntries(
    pack.files.map((f) => [f, readFileSync(join(packRulesDir(PACK), f), 'utf8')]),
  ) as Record<string, string>;

const NEW_FILE = 'crimeware/Nova_Regra.yar';
const NEW_RULE =
  'rule nova_regra { meta: author = "@bartblaze" strings: $a = "MARCA-NOVA" condition: $a }';
const SHA = (n: number) => String(n).repeat(40).slice(0, 40);

async function main() {
  env.CLAMAV_HOST = '';
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  const owner = await prisma.user.create({
    data: {
      email: 'adm@x.io',
      displayName: 'adm',
      role: 'ADMIN',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const cAdm = await login('adm@x.io');
  const cAna = await login('ana@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  await installYaraPacks();

  // Fonte de mentira, com o que cada teste quer devolver.
  let commit: { sha: string; date: Date } | null = null;
  let zip: Buffer = await makeZip(baseFiles());
  let untilAsked: Date | null = null;
  let zipFails = false;
  configurePackSource({
    latestCommit: async (repo, until) => {
      ok(
        'só o repositório do pacote',
        repo === pack.repo || yaraPacks().some((p) => p.repo === repo),
        repo,
      );
      untilAsked = until;
      return commit;
    },
    zip: async () => {
      if (zipFails) throw new Error('sem internet');
      return zip;
    },
  });
  const check = (apply = true) => checkYaraPack(PACK, { apply, actorId: owner.id });
  const newCommit = (n: number) => ({ sha: SHA(n), date: new Date(Date.now() + n * 86_400_000) });
  const ruleOf = (file: string) =>
    prisma.yaraRule.findFirst({ where: { pack: PACK, packFile: file } });
  const statusOf = (commitSha: string) =>
    prisma.yaraPackRelease.findFirst({ where: { pack: PACK, commit: commitSha } });

  // 1. Sem novidade.
  commit = { sha: pack.commit, date: new Date(`${pack.commitDate}T00:00:00Z`) };
  ok('mesma versão: nada', (await check()).outcome === 'current');
  ok(
    'pede só commit com pelo menos 7 dias',
    Boolean(untilAsked) && Date.now() - untilAsked!.getTime() >= 7 * 86_400_000 - 5000,
    untilAsked,
  );
  commit = { sha: SHA(9), date: new Date('2020-01-01T00:00:00Z') };
  ok('commit mais velho: nada', (await check()).outcome === 'current');
  commit = null;
  ok('sem commit: nada', (await check()).outcome === 'current');

  // 2. Regra excluida e desativada: escolhas do analista ficam.
  const [toDelete, toDisable, toChange, toRemove] = pack.files;
  const deleted = (await ruleOf(toDelete))!;
  await req('DELETE', `/api/yara/rules/${deleted.id}`, cAna);
  const disabled = (await ruleOf(toDisable))!;
  await req('PATCH', `/api/yara/rules/${disabled.id}`, cAna, { enabled: false });
  const removedBefore = (await ruleOf(toRemove))!;

  // 3. Previa nao aplica nada.
  const files = baseFiles();
  const changedText = `${files[toChange]}\n// alterado\n`;
  files[toChange] = changedText;
  files[toDisable] = `${files[toDisable]}\n// alterado\n`;
  files[NEW_FILE] = NEW_RULE;
  files['crimeware/Quebrada.yar'] = 'rule quebrada { condition: nao_existe }';
  delete files[toRemove];
  zip = await makeZip(files);
  commit = newCommit(1);
  const preview = await check(false);
  ok('prévia', preview.outcome === 'preview', preview);
  if (preview.outcome === 'preview') {
    ok(
      'prévia conta certo',
      preview.summary.added === 1 &&
        preview.summary.changed === 2 &&
        preview.summary.removed === 1 &&
        preview.summary.kept === 1,
      preview.summary,
    );
  }
  ok(
    'prévia não muda nada',
    !(await ruleOf(NEW_FILE)) && (await prisma.yaraPackRelease.count()) === 0,
  );

  // 4. Aplicar.
  const applied = await check();
  ok('aplica sozinho', applied.outcome === 'applied', applied);
  ok('regra nova entra ativa', (await ruleOf(NEW_FILE))?.enabled === true);
  ok('alterada recebe o texto novo', (await ruleOf(toChange))?.source === changedText);
  const stillOff = await ruleOf(toDisable);
  ok('desativada continua', stillOff?.enabled === false && stillOff.source.includes('// alterado'));
  ok('excluída não volta', !(await ruleOf(toDelete)));
  ok('removida na fonte sai', !(await ruleOf(toRemove)));
  ok('quebrada fica de fora', !(await ruleOf('crimeware/Quebrada.yar')));
  ok('versão registrada', (await loadPackState()).commits[PACK] === commit.sha);
  const hits = (
    await scanWithYara(Buffer.from('xx MARCA-NOVA'), scanContextOf({ originalFilename: 'a.bin' }))
  ).hits;
  ok(
    'regra nova detecta, com autor e pacote',
    hits[0]?.author === '@bartblaze' && hits[0]?.pack === 'bartblaze',
    hits,
  );
  ok(
    'auditada',
    (await prisma.auditEvent.count({
      where: { action: 'YARA_PACK_UPDATED', actorId: owner.id },
    })) === 1,
  );
  const notices = await prisma.notification.findMany({ where: { type: 'YARA_PACK_UPDATE' } });
  ok('admin recebe aviso, sem avisar quem fez', notices.length === 0, notices);

  // 5. Voltar a versao.
  const rel1 = (await statusOf(commit.sha))!;
  ok('registro aplicado', rel1.status === 'APPLIED' && rel1.canRollback);
  const rolled = await req('POST', `/api/admin/yara-releases/${rel1.id}/rollback`, cAdm, {});
  ok('volta', rolled.statusCode === 200, rolled.body);
  ok('regra nova sai', !(await ruleOf(NEW_FILE)));
  ok('alterada volta', (await ruleOf(toChange))?.source !== changedText);
  ok('removida volta', (await ruleOf(toRemove))?.source === removedBefore.source);
  ok('excluída continua fora', !(await ruleOf(toDelete)));
  ok('desativada continua', (await ruleOf(toDisable))?.enabled === false);
  ok('volta para a versão anterior', (await loadPackState()).commits[PACK] === pack.commit);
  ok('versão desfeita não volta sozinha', (await check()).outcome === 'skipped');
  ok(
    'não dá para voltar duas vezes',
    (await req('POST', `/api/admin/yara-releases/${rel1.id}/rollback`, cAdm, {})).statusCode ===
      409,
  );

  // 6. Licenca diferente: retida; uma por commit.
  zip = await makeZip(baseFilesWith(), Buffer.from('Outra licenca'));
  commit = newCommit(2);
  const held = await check();
  ok('licença mudou: retida', held.outcome === 'held' && held.reasons[0].includes('licença'), held);
  ok('não aplicou', !(await ruleOf(NEW_FILE)));
  await check();
  ok(
    'um registro por commit',
    (await prisma.yaraPackRelease.count({ where: { commit: commit.sha } })) === 1,
  );
  const heldNotice = await prisma.notification.count({
    where: { type: 'YARA_PACK_UPDATE', detail: { contains: 'retida' } },
  });
  ok('admin avisado uma vez', heldNotice === 2 - 1, heldNotice);

  // 7. Descartar e aprovar.
  const rel2 = (await statusOf(commit.sha))!;
  ok(
    'analista não descarta',
    (await req('POST', `/api/admin/yara-releases/${rel2.id}/dismiss`, cAna, {})).statusCode === 403,
  );
  await req('POST', `/api/admin/yara-releases/${rel2.id}/dismiss`, cAdm, {});
  ok('descartada não volta', (await check()).outcome === 'skipped');

  zip = await makeZip(baseFilesWith(), Buffer.from('Outra licenca'));
  commit = newCommit(3);
  await check();
  const rel3 = (await statusOf(commit.sha))!;
  const approved = await req('POST', `/api/admin/yara-releases/${rel3.id}/approve`, cAdm, {});
  ok('admin aprova', approved.statusCode === 200, approved.body);
  ok('aprovada entra', Boolean(await ruleOf(NEW_FILE)));
  ok('registro aplicado depois de aprovar', (await statusOf(commit.sha))?.status === 'APPLIED');
  ok('aprovada pode voltar', (await statusOf(commit.sha))?.canRollback === true);

  // 8. Mudanca grande: retida.
  const big = baseFilesWith();
  for (const f of Object.keys(big).slice(0, Math.ceil(pack.files.length * 0.3)))
    big[f] += '\n// muda\n';
  zip = await makeZip(big);
  commit = newCommit(4);
  const large = await check();
  ok(
    'mudança grande: retida',
    large.outcome === 'held' && large.reasons[0].includes('Mudança grande'),
    large,
  );

  // 9. Regra nova que dispara em amostra Limpa: retida, citando a regra e a amostra.
  const key = 'clean-sample';
  await s3.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: Buffer.from('xx MARCA-LIMPA') }),
  );
  await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'amostra-limpa',
      ownerId: owner.id,
      verdict: 'CLEAN',
      storageKey: key,
      bucket: env.S3_BUCKET,
      fileSize: 14,
      originalFilename: 'limpa.bin',
    },
  });
  const noisy = baseFilesWith();
  noisy['crimeware/Barulhenta.yar'] =
    'rule barulhenta { strings: $a = "MARCA-LIMPA" condition: $a }';
  zip = await makeZip(noisy);
  commit = newCommit(5);
  const clean = await check();
  ok(
    'dispara em amostra Limpa: retida',
    clean.outcome === 'held' &&
      clean.reasons.some((r) => r.includes('barulhenta') && r.includes('amostra-limpa')),
    clean,
  );

  // 10. Falhas: nada muda, e o motivo aparece.
  const rulesBefore = await prisma.yaraRule.count({ where: { pack: PACK } });
  commit = newCommit(6);
  zipFails = true;
  const failed = await req('POST', `/api/admin/yara-packs/${PACK}/check`, cAdm, { apply: true });
  ok(
    'sem internet: erro claro',
    failed.statusCode === 502 && failed.json().error.includes('sem internet'),
    failed.body,
  );
  ok(
    'sem internet: nada muda',
    (await prisma.yaraRule.count({ where: { pack: PACK } })) === rulesBefore,
  );
  ok('falha guardada', (await loadPackState()).lastError[PACK] === 'sem internet');
  const st = (await systemStatus()).checks.find((c: { id: string }) => c.id === 'yaraPacks');
  ok(
    'status avisa',
    st?.level === 'warn' && st.summary.includes('retida') && st.summary.includes('falha'),
    st,
  );
  zipFails = false;
  zip = await makeZip({});
  commit = newCommit(7);
  ok(
    'pacote vazio não apaga tudo',
    await check().then(
      () => false,
      (e: Error) => e.message.includes('sem regras'),
    ),
  );
  ok(
    'pacote vazio: nada muda',
    (await prisma.yaraRule.count({ where: { pack: PACK } })) === rulesBefore,
  );
  zip = Buffer.from('nao e zip');
  ok(
    'ZIP inválido: erro, sem mudar',
    await check().then(
      () => false,
      () => true,
    ),
  );

  // 11. Permissoes e agenda.
  ok(
    'analista não verifica',
    (await req('POST', `/api/admin/yara-packs/${PACK}/check`, cAna, {})).statusCode === 403,
  );
  ok(
    'pacote inexistente',
    (await req('POST', '/api/admin/yara-packs/nao/check', cAdm, {})).statusCode === 404,
  );
  const panel = (await req('GET', '/api/admin/yara-packs/updates', cAdm)).json();
  ok(
    'painel',
    panel.autoUpdate === true && panel.packs.length === 3 && panel.releases.length > 0,
    panel.packs,
  );
  ok(
    'painel sem a cópia guardada',
    panel.releases.every((r: { undo?: unknown }) => r.undo === undefined),
  );

  const log = { warn: () => undefined };
  const lastCheck = async () => (await loadPackState()).lastCheck.reversinglabs;
  commit = null;
  await runDuePackChecks(log);
  ok('agenda verifica os ligados', Boolean(await lastCheck()));
  const sigState = (await loadPackState()).lastCheck['signature-base'];
  ok('agenda não verifica o desligado', sigState === undefined, sigState);
  const first = await lastCheck();
  await runDuePackChecks(log);
  ok('agenda respeita a semana', (await lastCheck()) === first);
  await runDuePackChecks(log, Date.now() + 8 * 86_400_000);
  ok('passou a semana, verifica', (await lastCheck()) !== first);
  const off = await req('PATCH', '/api/admin/yara-packs/updates', cAdm, { autoUpdate: false });
  ok('desliga', off.json().autoUpdate === false);
  const second = await lastCheck();
  await runDuePackChecks(log, Date.now() + 30 * 86_400_000);
  ok('desligada, a agenda não verifica', (await lastCheck()) === second);

  // 12. Instalacao anterior a packFile: acha pelo nome; o que falta foi excluido.
  await prisma.yaraRule.updateMany({ where: { pack: 'reversinglabs' }, data: { packFile: null } });
  const rl = yaraPacks().find((p) => p.id === 'reversinglabs')!;
  const gone = rl.files[0];
  await prisma.yaraRule.deleteMany({
    where: { pack: 'reversinglabs', name: `reversinglabs/${gone.replace(/\.[^.]+$/, '')}` },
  });
  await installYaraPacks();
  ok(
    'acha o arquivo pelo nome',
    (await prisma.yaraRule.count({ where: { pack: 'reversinglabs', packFile: null } })) === 0,
  );
  ok('o que faltava fica lembrado', (await loadPackState()).deleted.reversinglabs?.includes(gone));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}

/** Versao atual mais a regra nova. */
function baseFilesWith(): Record<string, string> {
  return { ...baseFiles(), [NEW_FILE]: NEW_RULE };
}

main();
