import { execFileSync } from 'node:child_process';

import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { InsufficientAccessError, NoSuchObjectError } from 'ldapts';

import { env } from '../../src/env';
import { hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { hashPassword } from '../../src/lib/crypto';
import {
  adDisabled,
  configureLdap,
  escapeFilter,
  expandGroups,
  type LdapConfig,
} from '../../src/lib/ldap';
import { sweepLdapAccounts } from '../../src/lib/ldap-sweep';
import { prisma } from '../../src/lib/prisma';
import { systemStatus } from '../../src/lib/status';
import { adminRoutes } from '../../src/routes/admin';
import { authRoutes } from '../../src/routes/auth';
import { meRoutes } from '../../src/routes/me';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = `${process.env.TEST_TMP}/ldap`;
const base: Partial<LdapConfig> = {
  url: 'ldaps://localhost:6636',
  startTls: false,
  caFile: `${DIR}/certs/ca.crt`,
  bindDn: 'cn=admin,dc=empresa,dc=test',
  bindPassword: 'adminpw',
  baseDn: 'ou=people,dc=empresa,dc=test',
  userFilter: '(&(objectClass=inetOrgPerson)(|(uid={login})(mail={login})))',
  nameAttr: 'displayName',
  mailAttr: 'mail',
  analystGroup: 'cn=analistas,ou=groups,dc=empresa,dc=test',
  adminGroup: 'cn=admins,ou=groups,dc=empresa,dc=test',
};

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, meRoutes, adminRoutes]) await app.register(r);
  await app.ready();
  // Grupo de analistas so com quem for pedido (o teste pode rodar de novo).
  const setAnalysts = (uid: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'sh',
      '-c',
      `printf 'dn: cn=analistas,ou=groups,dc=empresa,dc=test\\nchangetype: modify\\nreplace: uniqueMember\\nuniqueMember: uid=${uid},ou=people,dc=empresa,dc=test\\n' | ldapmodify -x -H ldap://localhost -D cn=admin,dc=empresa,dc=test -w adminpw`,
    ]);
  setAnalysts('jsilva');
  await prisma.user.create({
    data: {
      email: 'ana@empresa.test',
      displayName: 'Ana Local',
      role: 'ADMIN',
      passwordHash: await hashPassword('Senha-Local-9!'),
    },
  });
  const login = (email: string, password: string, ip = '10.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
      remoteAddress: ip,
    });
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    String(r.headers['set-cookie']).split(';')[0];
  let ip = 0;
  const next = () => `10.0.1.${++ip}`;

  // 1. Sem AD: nada muda.
  configureLdap({ url: '' });
  ok(
    'sem AD: usuário do AD não entra',
    (await login('jsilva', 'Senha-AD-1', next())).statusCode === 401,
  );
  ok(
    'sem AD: conta local entra',
    (await login('ana@empresa.test', 'Senha-Local-9!', next())).statusCode === 200,
  );
  const statusOff = (await systemStatus()).checks.find((c: { id: string }) => c.id === 'ldap');
  ok('status: desligado', statusOff?.level === 'off', statusOff);

  // 2. Com AD (LDAPS, CA verificada).
  configureLdap(base);
  let r = await login('jsilva', 'Senha-AD-1', next());
  ok(
    'primeiro acesso pelo AD',
    r.statusCode === 200 &&
      r.json().user.ldap === true &&
      r.json().user.role === 'ANALYST' &&
      r.json().user.displayName === 'João Silva' &&
      r.json().user.email === 'joao.silva@empresa.test',
    r.json(),
  );
  ok(
    'sem troca de senha nem validade',
    r.json().user.mustChangePassword === false && r.json().user.passwordExpiresAt === null,
  );
  const jsilva = await prisma.user.findUniqueOrThrow({
    where: { email: 'joao.silva@empresa.test' },
  });
  ok(
    'conta criada como do AD',
    jsilva.authSource === 'LDAP' && jsilva.ldapDn === 'uid=jsilva,ou=people,dc=empresa,dc=test',
  );
  ok(
    'cadastro na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'USER_REGISTERED', targetUserId: jsilva.id },
    })) === 1,
  );
  ok(
    'entra pelo e-mail também',
    (await login('JOAO.SILVA@empresa.test', 'Senha-AD-1', next())).statusCode === 200,
  );
  ok('não duplica a conta', (await prisma.user.count({ where: { authSource: 'LDAP' } })) === 1);
  r = await login('mcosta', 'Senha-AD-2', next());
  ok('grupo de admins vira admin', r.json().user?.role === 'ADMIN');
  r = await login('pnovo', 'Senha-AD-3', next());
  ok('sem grupo, usuário comum', r.json().user?.role === 'USER');

  // 3. Mesma resposta para tudo; nada de enumerar.
  const wrong = await login('jsilva', 'errada', next());
  const ghost = await login('ninguem', 'Senha-AD-1', next());
  ok(
    'senha errada e usuário inexistente iguais',
    wrong.statusCode === 401 && ghost.statusCode === 401 && wrong.body === ghost.body,
    [wrong.body, ghost.body],
  );
  ok(
    'injeção no filtro não passa',
    (await login('*', 'Senha-AD-1', next())).statusCode === 401 &&
      (await login('*)(uid=*', 'Senha-AD-1', next())).statusCode === 401,
  );
  ok('escape RFC 4515', escapeFilter('a*b(c)\\d') === 'a\\2ab\\28c\\29\\5cd');
  ok(
    'conta do AD sem e-mail não entra',
    (await login('semail', 'Senha-AD-4', next())).statusCode === 401,
  );
  const fail = await prisma.auditEvent.findFirst({
    where: { action: 'LOGIN_FAILED', detail: { contains: 'sem e-mail' } },
  });
  ok('motivo real só na auditoria', Boolean(fail));

  // 4. Conta local com o mesmo e-mail: o AD nao assume.
  ok('AD não assume conta local', (await login('ana', 'Senha-AD-5', next())).statusCode === 401);
  ok(
    'conta local segue com a senha local',
    (await login('ana@empresa.test', 'Senha-Local-9!', next())).statusCode === 200,
  );

  // 5. Suspensa no DeepLook: nao entra; senha errada continua 401.
  await prisma.user.update({ where: { id: jsilva.id }, data: { status: 'SUSPENDED' } });
  ok(
    'suspensa não entra com a senha certa',
    (await login('jsilva', 'Senha-AD-1', next())).statusCode === 403,
  );
  ok(
    'suspensa com senha errada: 401',
    (await login('jsilva', 'errada', next())).statusCode === 401,
  );
  await prisma.user.update({ where: { id: jsilva.id }, data: { status: 'ACTIVE' } });

  // 6. 2FA do DeepLook continua valendo.
  await prisma.user.update({
    where: { id: jsilva.id },
    data: { twoFactorEnabledAt: new Date(), twoFactorSecret: 'x' },
  });
  r = await login('joao.silva@empresa.test', 'Senha-AD-1', next());
  ok(
    '2FA pedido depois do AD',
    r.statusCode === 200 && r.json().twoFactorRequired === true && !r.headers['set-cookie'],
    r.json(),
  );
  await prisma.user.update({
    where: { id: jsilva.id },
    data: { twoFactorEnabledAt: null, twoFactorSecret: null },
  });

  // 7. Senha local nao vale e nao se troca.
  ok(
    'senha local aleatória não serve',
    (await login('joao.silva@empresa.test', 'qualquer', next())).statusCode === 401,
  );
  const cj = cookieOf(await login('joao.silva@empresa.test', 'Senha-AD-1', next()));
  r = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { cookie: cj },
    payload: { currentPassword: 'x', newPassword: 'Nova-Senha-Forte-1!' },
  });
  ok('troca de senha recusada', r.statusCode === 409 && r.json().error.includes('AD'), r.json());
  const ca = cookieOf(await login('ana@empresa.test', 'Senha-Local-9!', next()));
  r = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${jsilva.id}/reset-password`,
    headers: { cookie: ca },
  });
  ok('admin não redefine a senha do AD', r.statusCode === 409);

  // 8. Papel segue os grupos a cada login.
  setAnalysts('semail');
  r = await login('joao.silva@empresa.test', 'Senha-AD-1', next());
  ok('fora do grupo, volta a usuário comum', r.json().user?.role === 'USER');
  ok(
    'mudança de papel auditada',
    (await prisma.auditEvent.count({
      where: { action: 'USER_ROLE_CHANGED', targetUserId: jsilva.id },
    })) === 1,
  );

  // 9. StartTLS; sem TLS recusa; CA errada recusa.
  configureLdap({ ...base, url: 'ldap://localhost:6389', startTls: true });
  ok('StartTLS funciona', (await login('pnovo', 'Senha-AD-3', next())).statusCode === 200);
  configureLdap({ ...base, url: 'ldap://localhost:6389', startTls: false });
  ok('ldap:// sem TLS recusado', (await login('pnovo', 'Senha-AD-3', next())).statusCode === 401);
  let st = (await systemStatus()).checks.find((c: { id: string }) => c.id === 'ldap');
  ok('status: sem TLS é erro', st?.level === 'error' && st.summary.includes('sem TLS'), st);
  configureLdap({ ...base, caFile: `${DIR}/other/ca.crt` });
  ok(
    'certificado de outra CA recusado',
    (await login('pnovo', 'Senha-AD-3', next())).statusCode === 401,
  );
  st = (await systemStatus()).checks.find((c: { id: string }) => c.id === 'ldap');
  ok('status: erro de certificado', st?.level === 'error', st);
  configureLdap(base);
  st = (await systemStatus()).checks.find((c: { id: string }) => c.id === 'ldap');
  ok(
    'status: conectado com as contas',
    st?.level === 'ok' &&
      st.details.some(
        (d: { label: string; value: string }) => d.label === 'Contas do AD' && d.value === '3',
      ),
    st,
  );

  // 10. Senha vazia nunca (bind anonimo).
  ok('senha vazia recusada', (await login('mcosta', '', next())).statusCode === 400);
  for (let i = 0; i < 5; i++) await login('maria.costa@empresa.test', 'errada', '10.9.9.9');
  ok(
    'limite de tentativas vale para o AD',
    (await login('maria.costa@empresa.test', 'Senha-AD-2', '10.9.9.9')).statusCode === 429,
  );

  // 11. Papel de conta do AD nao se edita (item 107); o da local sim.
  const adminCookie = cookieOf(await login('ana@empresa.test', 'Senha-Local-9!', next()));
  const patchRole = (id: string, role: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${id}`,
      headers: { cookie: adminCookie },
      payload: { role },
    });
  const pnovo = await prisma.user.findUniqueOrThrow({
    where: { email: 'pedro.novo@empresa.test' },
  });
  ok('papel do AD não se edita', (await patchRole(pnovo.id, 'ANALYST')).statusCode === 409);
  const localUser = await prisma.user.create({
    data: { email: 'local@empresa.test', displayName: 'Local', role: 'USER', passwordHash: 'x' },
  });
  ok(
    'papel da conta local se edita',
    (await patchRole(localUser.id, 'ANALYST')).statusCode === 200,
  );

  // 12. Primeiro acesso simultaneo sem erro 500 (item 110).
  const addUser = (uid: string, mail: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'sh',
      '-c',
      `printf 'dn: uid=${uid},ou=people,dc=empresa,dc=test\\nobjectClass: inetOrgPerson\\nuid: ${uid}\\ncn: ${uid}\\nsn: x\\nmail: ${mail}\\nuserPassword: Senha-AD-9\\n' | ldapadd -x -H ldap://localhost -D cn=admin,dc=empresa,dc=test -w adminpw`,
    ]);
  const delUser = (uid: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'ldapdelete',
      '-x',
      '-H',
      'ldap://localhost',
      '-D',
      'cn=admin,dc=empresa,dc=test',
      '-w',
      'adminpw',
      `uid=${uid},ou=people,dc=empresa,dc=test`,
    ]);
  const unique = `par${Date.now()}`;
  addUser(unique, `${unique}@empresa.test`);
  const both = await Promise.all([1, 2, 3].map(() => login(unique, 'Senha-AD-9', next())));
  ok(
    'primeiros acessos simultâneos entram',
    both.every((x) => x.statusCode === 200),
    both.map((x) => x.statusCode),
  );
  ok(
    'uma conta só',
    (await prisma.user.count({ where: { email: `${unique}@empresa.test` } })) === 1,
  );

  // 13. E-mail novo do AD que ja e de outra conta: entra com o antigo (item 110).
  const setMail = (uid: string, mail: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'sh',
      '-c',
      `printf 'dn: uid=${uid},ou=people,dc=empresa,dc=test\\nchangetype: modify\\nreplace: mail\\nmail: ${mail}\\n' | ldapmodify -x -H ldap://localhost -D cn=admin,dc=empresa,dc=test -w adminpw`,
    ]);
  setMail(unique, 'local@empresa.test');
  const collided = await login(unique, 'Senha-AD-9', next());
  ok('colisão de e-mail não dá 500', collided.statusCode !== 500, collided.statusCode);
  setMail(unique, `${unique}@empresa.test`);

  // 14. Quem sai do AD perde o acesso (item 108).
  ok('bit de conta desativada', adDisabled('514') && !adDisabled('512') && !adDisabled(undefined));
  const leaving = await prisma.user.findUniqueOrThrow({
    where: { email: `${unique}@empresa.test` },
  });
  const secret = newTokenSecret();
  const token = await prisma.apiToken.create({
    data: {
      userId: leaving.id,
      name: 'ci',
      prefix: secret.slice(0, 12),
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  ok('tem sessão antes', (await prisma.session.count({ where: { userId: leaving.id } })) > 0);
  let sweep = await sweepLdapAccounts();
  ok(
    'quem continua no AD não é suspenso',
    sweep.suspended.length === 0 && sweep.checked >= 3,
    sweep,
  );
  configureLdap({ ...base, url: 'ldaps://localhost:1' });
  let down = false;
  try {
    await sweepLdapAccounts();
  } catch {
    down = true;
  }
  ok(
    'AD fora do ar: falha sem suspender',
    down &&
      (await prisma.user.findUniqueOrThrow({ where: { id: leaving.id } })).status === 'ACTIVE',
  );
  configureLdap({ ...base, baseDn: 'ou=people,dc=empresa,dc=test' });
  delUser(unique);
  sweep = await sweepLdapAccounts();
  ok('saiu do AD: suspensa', sweep.suspended.includes(leaving.email), sweep);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: leaving.id } });
  ok(
    'saiu do AD: sessões e tokens caem',
    after.status === 'SUSPENDED' &&
      (await prisma.session.count({ where: { userId: leaving.id } })) === 0 &&
      Boolean((await prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt),
  );
  ok(
    'saída na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'USER_SUSPENDED', targetUserId: leaving.id },
    })) === 1,
  );

  // 15. Quase todos "sumidos": erro de configuracao, ninguem e suspenso.
  await prisma.user.updateMany({
    where: { authSource: 'LDAP', status: 'ACTIVE' },
    data: { ldapDn: null },
  });
  const fake = ['a1', 'a2', 'a3'];
  for (const u of fake) {
    await prisma.user.create({
      data: {
        email: `${u}@empresa.test`,
        displayName: u,
        passwordHash: 'x',
        authSource: 'LDAP',
        ldapDn: `uid=${u},ou=errado,dc=empresa,dc=test`,
      },
    });
  }
  sweep = await sweepLdapAccounts();
  ok('muitos sumidos: não suspende', sweep.suspended.length === 0 && Boolean(sweep.skipped), sweep);
  ok(
    'muitos sumidos: contas intactas',
    (await prisma.user.count({
      where: { email: { in: fake.map((u) => `${u}@empresa.test`) }, status: 'ACTIVE' },
    })) === 3,
  );

  // 16. Grupos dentro de grupos (item 124), no OpenLDAP real.
  const G = 'ou=groups,dc=empresa,dc=test';
  const addGroup = (cn: string, member: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'sh',
      '-c',
      `printf 'dn: cn=${cn},${G}\\nobjectClass: groupOfUniqueNames\\ncn: ${cn}\\nuniqueMember: ${member}\\n' | ldapadd -x -H ldap://localhost -D cn=admin,dc=empresa,dc=test -w adminpw`,
    ]);
  const addMember = (cn: string, member: string) =>
    execFileSync('docker', [
      'exec',
      'dl-ldap',
      'sh',
      '-c',
      `printf 'dn: cn=${cn},${G}\\nchangetype: modify\\nadd: uniqueMember\\nuniqueMember: ${member}\\n' | ldapmodify -x -H ldap://localhost -D cn=admin,dc=empresa,dc=test -w adminpw`,
    ]);
  const uniq = Date.now();
  const PNOVO = 'uid=pnovo,ou=people,dc=empresa,dc=test';
  const [low, mid, top, cycleA, cycleB] = ['low', 'mid', 'top', 'cya', 'cyb'].map(
    (n) => `n${n}${uniq}`,
  );
  addGroup(low, PNOVO);
  addGroup(mid, `cn=${low},${G}`);
  addGroup(top, `cn=${mid},${G}`);
  addGroup(cycleA, `cn=${low},${G}`);
  addGroup(cycleB, `cn=${cycleA},${G}`);
  addMember(cycleA, `cn=${cycleB},${G}`);
  const nested = (extra: Partial<LdapConfig>) =>
    configureLdap({
      ...base,
      analystGroup: `cn=${top},${G}`,
      adminGroup: 'cn=ninguem,ou=groups,dc=empresa,dc=test',
      ...extra,
    });
  const roleOfPnovo = async () =>
    (await login('pedro.novo@empresa.test', 'Senha-AD-3', next())).json().user?.role;
  await prisma.user.updateMany({
    where: { email: 'pedro.novo@empresa.test' },
    data: { ldapDn: PNOVO },
  });
  nested({ nestedGroups: false });
  ok('desligado: grupo indireto não dá papel', (await roleOfPnovo()) === 'USER');
  nested({ nestedGroups: true });
  ok('ligado: dois níveis acima dão analista', (await roleOfPnovo()) === 'ANALYST');
  nested({ nestedGroups: true, adminGroup: `cn=${top},${G}`, analystGroup: `cn=${low},${G}` });
  ok('admin indireto ganha do analista direto', (await roleOfPnovo()) === 'ADMIN');
  nested({ nestedGroups: true, analystGroup: 'cn=ninguem,ou=groups,dc=empresa,dc=test' });
  ok('ciclo termina e não dá papel', (await roleOfPnovo()) === 'USER');
  nested({ nestedGroups: true, adminGroup: `cn=${low},${G}` });
  ok('admin direto não precisa subir', (await roleOfPnovo()) === 'ADMIN');
  configureLdap(base);

  // 17. A subida: erros, teto e DN escrito de outro jeito (cliente de mentira).
  const fakeClient = (tree: Record<string, string[] | Error>) => {
    const asked: string[] = [];
    return {
      asked,
      client: {
        search: async (dn: string) => {
          asked.push(dn);
          const found = tree[dn];
          if (found instanceof Error) throw found;
          return { searchEntries: [{ dn, memberOf: found ?? [] }], searchReferences: [] };
        },
      } as unknown as Parameters<typeof expandGroups>[0],
    };
  };
  let walk = fakeClient({ a: new NoSuchObjectError(), b: new InsufficientAccessError(), c: ['d'] });
  ok(
    'grupo recusado ou sumido é ignorado',
    (await expandGroups(walk.client, ['a', 'b', 'c'])).join() === 'a,b,c,d',
  );
  walk = fakeClient({ a: new Error('socket fechado') });
  let thrown = false;
  await expandGroups(walk.client, ['a']).catch(() => {
    thrown = true;
  });
  ok('queda de conexão lança', thrown);
  walk = fakeClient({ a: ['b'], b: ['c'], c: ['d'], d: ['e'] });
  const capped = await expandGroups(walk.client, ['a'], 2);
  ok('teto de grupos lidos', walk.asked.length === 2 && capped.join() === 'a,b,c', capped);
  walk = fakeClient({ 'CN=A, DC=X': ['cn=b,dc=x'], 'cn=b,dc=x': ['cn=a,dc=x'] });
  await expandGroups(walk.client, ['CN=A, DC=X']);
  ok('mesmo DN escrito diferente não repete', walk.asked.length === 2, walk.asked);

  // 18. Duas contas do AD com o mesmo e-mail: a segunda nao assume a primeira.
  configureLdap(base);
  const gemeo1 = await login('gemeo1', 'Senha-Gemeo-1', next());
  ok('primeira conta com o e-mail entra', gemeo1.statusCode === 200, gemeo1.json());
  const gemeoDn = 'uid=gemeo1,ou=people,dc=empresa,dc=test';
  const gemeoId = gemeo1.json().user.id as string;
  const gemeo2 = await login('gemeo2', 'Senha-Gemeo-2', next());
  ok('segunda conta com o mesmo e-mail é recusada', gemeo2.statusCode === 401, gemeo2.json());
  const afterTwin = await prisma.user.findUniqueOrThrow({ where: { id: gemeoId } });
  ok('o vínculo da primeira não muda', afterTwin.ldapDn === gemeoDn, afterTwin.ldapDn);
  ok(
    'recusa na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'LOGIN_FAILED', detail: { contains: 'outra conta do AD' } },
    })) === 1,
  );
  ok(
    'a primeira continua entrando',
    (await login('gemeo1', 'Senha-Gemeo-1', next())).statusCode === 200,
  );

  // DN antigo que nao existe mais (mudou de OU): religa, audita e derruba as sessoes.
  await prisma.user.update({
    where: { id: gemeoId },
    data: { ldapDn: 'uid=gemeo1,ou=antiga,dc=empresa,dc=test' },
  });
  const oldSession = cookieOf(await login('gemeo1', 'Senha-Gemeo-1', next()));
  await prisma.user.update({
    where: { id: gemeoId },
    data: { ldapDn: 'uid=gemeo1,ou=antiga,dc=empresa,dc=test' },
  });
  const movedLogin = await prisma.session.count({ where: { userId: gemeoId } });
  const relinked = await prisma.auditEvent.count({
    where: { action: 'USER_LDAP_RELINKED', targetUserId: gemeoId },
  });
  const moved = await login('gemeo2', 'Senha-Gemeo-2', next());
  ok(
    'DN antigo sumiu: quem tem o e-mail religa',
    moved.statusCode === 200 && moved.json().user.id === gemeoId,
    moved.json(),
  );
  ok(
    'religar fica na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'USER_LDAP_RELINKED', targetUserId: gemeoId },
    })) ===
      relinked + 1,
  );
  ok(
    'religar derruba as sessões antigas',
    movedLogin > 0 &&
      !(await prisma.session.findUnique({ where: { id: oldSession.split('=')[1] } })),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
