import { spawnSync } from 'node:child_process';

import bcrypt from 'bcryptjs';

import { prisma } from '../../src/lib/prisma';
import { insecureDefaults } from '../../src/lib/status';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const GOOD = '0123456789abcdef0123456789abcdef';
const DEFAULT_SECRET = 'change-me-please-use-a-long-random-secret';
const DEFAULT_TOKEN = 'troque-este-token-da-captura';

/** Sobe o modulo de ambiente noutro processo: a recusa encerra com saida 1. */
const boot = (vars: Record<string, string>) =>
  spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', "import('./src/env').then(()=>process.exit(0))"],
    { env: { ...process.env, NODE_ENV: 'production', CAPTURE_URL: '', ...vars }, encoding: 'utf8' },
  );
const seed = (vars: Record<string, string>) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/seed.ts'], {
    env: { ...process.env, ...vars },
    encoding: 'utf8',
  });

async function main() {
  // 1. Segredos conhecidos.
  const refused = boot({ SESSION_SECRET: DEFAULT_SECRET });
  ok(
    'SESSION_SECRET padrão recusado',
    refused.status === 1 && refused.stderr.includes('SESSION_SECRET'),
    refused.stderr,
  );
  ok(
    'CAPTURE_TOKEN padrão recusado',
    boot({ SESSION_SECRET: GOOD, CAPTURE_URL: 'http://capture:3100', CAPTURE_TOKEN: DEFAULT_TOKEN })
      .status === 1,
  );
  ok(
    'token padrão sem captura sobe',
    boot({ SESSION_SECRET: GOOD, CAPTURE_TOKEN: DEFAULT_TOKEN }).status === 0,
  );
  ok(
    'demonstração sobe',
    boot({ SESSION_SECRET: DEFAULT_SECRET, ALLOW_INSECURE_DEFAULTS: 'true' }).status === 0,
  );
  ok(
    'segredos próprios sobem',
    boot({
      SESSION_SECRET: GOOD,
      CAPTURE_URL: 'http://capture:3100',
      CAPTURE_TOKEN: 'abcdefabcdefabcdef12',
    }).status === 0,
  );
  ok(
    'SESSION_SECRET curto recusado em produção',
    boot({ SESSION_SECRET: '0123456789abcdef0123' }).status === 1,
  );
  ok(
    'SESSION_SECRET curto sobe fora de produção',
    boot({ NODE_ENV: 'development', SESSION_SECRET: '0123456789abcdef0123' }).status === 0,
  );
  ok(
    'fora de produção sobe',
    boot({ NODE_ENV: 'development', SESSION_SECRET: DEFAULT_SECRET }).status === 0,
  );

  // 2. Admin.
  const vars = { ADMIN_EMAIL: 'a@x.io', ADMIN_PASSWORD: 'Senha-Do-Env-1' };
  const must = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { email: 'a@x.io' } })).mustChangePassword;
  seed(vars);
  ok('admin novo troca a senha', await must());
  await prisma.user.update({ where: { email: 'a@x.io' }, data: { mustChangePassword: false } });
  seed(vars);
  ok('admin com senha própria não muda', !(await must()));
  await prisma.user.update({
    where: { email: 'a@x.io' },
    data: { passwordHash: await bcrypt.hash('admin12345', 4) },
  });
  seed(vars);
  ok('admin existente com a senha padrão troca', await must());
  const rotated = await prisma.user.findUniqueOrThrow({ where: { email: 'a@x.io' } });
  ok(
    'senha padrão vira a do ADMIN_PASSWORD',
    (await bcrypt.compare('Senha-Do-Env-1', rotated.passwordHash)) &&
      !(await bcrypt.compare('admin12345', rotated.passwordHash)),
  );
  await prisma.user.update({
    where: { email: 'a@x.io' },
    data: { passwordHash: await bcrypt.hash('admin12345', 4), mustChangePassword: false },
  });
  seed({ ...vars, ADMIN_PASSWORD: 'admin12345' });
  const kept = await prisma.user.findUniqueOrThrow({ where: { email: 'a@x.io' } });
  ok(
    'sem senha própria no .env, a padrão fica (com troca obrigatória)',
    kept.mustChangePassword && (await bcrypt.compare('admin12345', kept.passwordHash)),
  );

  // 3. Status do sistema (esta rodada usa a senha de teste do banco e a do MinIO de teste).
  ok(
    'avisa a senha padrão do MinIO',
    insecureDefaults().some((i) => i.includes('MinIO')),
    insecureDefaults(),
  );
  ok(
    'não acusa a senha de teste do banco',
    !insecureDefaults().some((i) => i.includes('banco')),
    insecureDefaults(),
  );

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
