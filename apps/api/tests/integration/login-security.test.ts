import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { createCaptcha } from '../../src/lib/captcha';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { insecureDefaults } from '../../src/lib/status';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const PASSWORD = 'Senha-Forte-123!';

async function main() {
  const app = await buildApp();
  await app.ready();
  const hash = await hashPassword(PASSWORD);
  const mk = (email: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email, displayName: email.split('@')[0], role: 'USER', passwordHash: hash, ...data },
    });
  const login = (email: string, password: string, ip: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
      remoteAddress: ip,
    });

  // 1. Quem o IP do cliente pode informar (item 112).
  // O app da producao (src/app.ts), com o trustProxy que ele usa, e uma rota que so devolve o IP.
  const probe = await buildApp({
    beforeRoutes: (a) => {
      a.get('/ip', async (req) => ({ ip: req.ip }));
    },
  });
  await probe.ready();
  const seen = async (remoteAddress: string, forwarded: string) =>
    (
      await probe.inject({
        method: 'GET',
        url: '/ip',
        remoteAddress,
        headers: { 'x-forwarded-for': forwarded },
      })
    ).json().ip;
  ok(
    'nginx em rede privada informa o IP',
    (await seen('172.18.0.5', '203.0.113.7')) === '203.0.113.7',
  );
  ok(
    'endereço público não informa',
    (await seen('198.51.100.9', '203.0.113.7')) === '198.51.100.9',
  );
  await probe.close();

  // 2. Bloqueio nao atinge quem esta em outro IP (item 113).
  await mk('vitima@x.io');
  for (let i = 0; i < 5; i++) await login('vitima@x.io', 'errada', '203.0.113.1');
  ok(
    'atacante bloqueado',
    (await login('vitima@x.io', 'errada', '203.0.113.1')).statusCode === 429,
  );
  ok(
    'a dona da conta entra de outro IP',
    (await login('vitima@x.io', PASSWORD, '203.0.113.2')).statusCode === 200,
  );

  // 3. Uma senha em muitas contas, do mesmo IP.
  const spray = [];
  for (let i = 0; i < 32; i++) spray.push(await login(`alvo${i}@x.io`, 'Senha123', '203.0.113.3'));
  ok(
    'muitas contas de um IP: barrado',
    spray.slice(0, 30).every((r) => r.statusCode === 401) &&
      spray.slice(30).every((r) => r.statusCode === 429),
    spray.map((r) => r.statusCode).join(),
  );
  ok(
    'outro IP segue normal',
    (await login('alvo1@x.io', 'Senha123', '203.0.113.4')).statusCode === 401,
  );

  // 4. Uma conta de muitos IPs: CAPTCHA para dispositivo novo, sem trancar a dona.
  await mk('muitos@x.io');
  const many = [];
  for (let i = 0; i < 21; i++) many.push(await login('muitos@x.io', 'errada', `198.18.0.${i + 1}`));
  ok(
    'uma conta de muitos IPs: pede CAPTCHA',
    many.slice(0, 20).every((r) => r.statusCode === 401) &&
      many[20].statusCode === 428 &&
      many[20].json().captchaRequired === true &&
      typeof many[20].json().captcha?.token === 'string' &&
      many[20].json().captcha?.image.includes('<svg'),
    many.map((r) => r.statusCode).join(),
  );
  const withCaptcha = (password: string, token?: string, answer?: string, ip = '198.18.9.9') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'muitos@x.io', password, captchaToken: token, captchaAnswer: answer },
      remoteAddress: ip,
    });
  const first = createCaptcha();
  ok('sem resposta: 428', (await withCaptcha(PASSWORD)).statusCode === 428);
  ok(
    'resposta errada: 428 e nova imagem',
    (await withCaptcha(PASSWORD, first.token, 'zzzzz')).statusCode === 428,
  );
  ok(
    'token gasto não vale de novo, nem com a resposta certa',
    (await withCaptcha(PASSWORD, first.token, first.text)).statusCode === 428,
  );
  const second = createCaptcha();
  ok(
    'a dona entra com o CAPTCHA certo (maiúsculas e espaços não importam)',
    (await withCaptcha(PASSWORD, second.token, ` ${second.text.toUpperCase()} `)).statusCode ===
      200,
  );
  const forged = createCaptcha();
  const [exp, nonce] = forged.token.split('.');
  ok(
    'token adulterado recusado',
    (await withCaptcha(PASSWORD, `${exp}.${nonce}.AAAA`, forged.text)).statusCode === 428,
  );
  ok(
    'palpite errado com CAPTCHA certo segue 401',
    await (async () => {
      const c = createCaptcha();
      return (await withCaptcha('errada', c.token, c.text, '198.18.9.10')).statusCode === 401;
    })(),
  );
  const fresh = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
  ok(
    'nova imagem sob demanda',
    fresh.statusCode === 200 && fresh.json().token && fresh.json().image.includes('<svg'),
    fresh.body.slice(0, 100),
  );

  // 5. Suspensa so aparece com a senha certa.
  await mk('suspensa@x.io', { status: 'SUSPENDED' });
  const wrong = await login('suspensa@x.io', 'errada', '198.18.1.1');
  const ghost = await login('ninguem@x.io', 'errada', '198.18.1.2');
  ok(
    'suspensa com senha errada = inexistente',
    wrong.statusCode === 401 && wrong.body === ghost.body,
  );
  ok(
    'suspensa com a senha certa: 403',
    (await login('suspensa@x.io', PASSWORD, '198.18.1.3')).statusCode === 403,
  );

  // 6. Tempo: inexistente tambem paga o bcrypt.
  const timed = async (email: string, ip: string) => {
    const start = Date.now();
    await login(email, 'errada', ip);
    return Date.now() - start;
  };
  const existing = await mk('tempo@x.io');
  const times = { real: 0, ghost: 0 };
  for (let i = 0; i < 3; i++) {
    times.real += await timed(existing.email, `198.18.2.${i + 1}`);
    times.ghost += await timed(`fantasma${i}@x.io`, `198.18.3.${i + 1}`);
  }
  ok('tempo sem revelar o cadastro', times.ghost > times.real * 0.5, times);

  // 7. Cadastro: chave nao e testada a vontade.
  const tries = [];
  for (let i = 0; i < 11; i++) {
    tries.push(
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: '198.18.4.1',
        payload: {
          email: `c${i}@x.io`,
          displayName: 'C',
          password: PASSWORD,
          activationKey: `X${i}`,
        },
      }),
    );
  }
  ok(
    'chaves testadas: limite',
    tries.at(-1)?.statusCode === 429,
    tries.map((t) => t.statusCode).join(),
  );

  // 8. Auditoria da configuracao (item 114).
  await mk('adm@x.io', { role: 'ADMIN' });
  const cAdm = String(
    (await login('adm@x.io', PASSWORD, '198.18.5.1')).headers['set-cookie'],
  ).split(';')[0];
  const call = (method: string, url: string, payload?: object) =>
    app.inject({ method: method as 'POST', url, headers: { cookie: cAdm }, payload });
  const count = (action: string) =>
    prisma.auditEvent.count({ where: { action: action as 'LOGIN_FAILED' } });

  const domain = (await call('POST', '/api/company-domains', { domain: 'empresa.com.br' })).json()
    .item;
  ok('domínio incluído', (await count('COMPANY_DOMAIN_ADDED')) === 1);
  await call('DELETE', `/api/company-domains/${domain.id}`);
  ok('domínio excluído', (await count('COMPANY_DOMAIN_REMOVED')) === 1);

  const rule = (
    await call('POST', '/api/triage-rules', { name: 'Macro', condition: 'MACRO', tags: ['macro'] })
  ).json().rule;
  await call('PATCH', `/api/triage-rules/${rule.id}`, { enabled: false });
  await call('DELETE', `/api/triage-rules/${rule.id}`);
  const ruleLog = await prisma.auditEvent.findMany({
    where: { action: 'TRIAGE_RULE_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
  ok(
    'regra criada, desligada e excluída',
    ruleLog.length === 3 &&
      ruleLog.every((e) => e.targetLabel === 'Macro') &&
      ruleLog[2].detail === 'excluída',
    ruleLog.map((e) => e.detail),
  );

  const group = (await call('POST', '/api/assignment/groups', { name: 'SOC' })).json().group;
  const assignmentRule = (
    await call('POST', '/api/assignment/rules', { groupId: group.id, entryType: 'FILE' })
  ).json().rule;
  await call('DELETE', `/api/assignment/rules/${assignmentRule.id}`);
  await call('DELETE', `/api/assignment/groups/${group.id}`);
  ok(
    'atribuição auditada',
    (await count('ASSIGNMENT_CHANGED')) === 4,
    await count('ASSIGNMENT_CHANGED'),
  );

  const notice = (
    await call('POST', '/api/broadcasts', { text: 'Aviso de teste', hours: 4 })
  ).json().item;
  await call('POST', `/api/broadcasts/${notice.id}/end`);
  ok(
    'aviso publicado e encerrado',
    (await count('BROADCAST_PUBLISHED')) === 1 && (await count('BROADCAST_ENDED')) === 1,
  );

  // 9. Senha padrao do admin (publica): em producao nao entra.
  await mk('padrao@x.io', { role: 'ADMIN', passwordHash: await hashPassword('admin12345') });
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = 'production';
  const blocked = await login('padrao@x.io', 'admin12345', '10.9.0.1');
  ok(
    'senha padrão pública recusada em produção',
    blocked.statusCode === 403 &&
      blocked.json().code === 'PUBLIC_DEFAULT_PASSWORD' &&
      !String(blocked.headers['set-cookie'] ?? '').includes('dl_session='),
    blocked.json(),
  );
  env.ALLOW_INSECURE_DEFAULTS = 'true';
  ok(
    'demonstração (ALLOW_INSECURE_DEFAULTS) entra',
    (await login('padrao@x.io', 'admin12345', '10.9.0.2')).statusCode === 200,
  );
  env.ALLOW_INSECURE_DEFAULTS = 'false';
  env.NODE_ENV = nodeEnv;
  ok(
    'fora de produção entra',
    (await login('padrao@x.io', 'admin12345', '10.9.0.3')).statusCode === 200,
  );

  // 10. Status avisa o cookie (item 115).
  ok(
    'status avisa COOKIE_SECURE',
    insecureDefaults().some((i) => i.includes('COOKIE_SECURE')),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
