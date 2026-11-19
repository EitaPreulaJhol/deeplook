import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// ---- Autenticador virtual: ES256, atestado "none", verificacao do usuario ligada ------------

const b64u = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const ORIGIN = 'http://localhost';
const RP_ID = 'localhost';

/** Cabecalho CBOR de bytes (tipo 2) com o tamanho. */
const cborBytes = (data: Buffer) => {
  const head =
    data.length < 24
      ? Buffer.from([0x40 | data.length])
      : data.length < 256
        ? Buffer.from([0x58, data.length])
        : Buffer.from([0x59, data.length >> 8, data.length & 255]);
  return Buffer.concat([head, data]);
};
const cborText = (s: string) => Buffer.concat([Buffer.from([0x60 | s.length]), Buffer.from(s)]);

class Authenticator {
  readonly credentialId = randomBytes(32);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;

  private cose() {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    return Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]),
      cborBytes(x),
      Buffer.from([0x22]),
      cborBytes(y),
    ]);
  }

  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  create(challenge: string, origin = ORIGIN, rpId = RP_ID) {
    const credId = Buffer.alloc(2);
    credId.writeUInt16BE(this.credentialId.length);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([0x45]), // UP + UV + dados da credencial
      counter,
      Buffer.alloc(16),
      credId,
      this.credentialId,
      this.cose(),
    ]);
    const attestation = Buffer.concat([
      Buffer.from([0xa3]),
      cborText('fmt'),
      cborText('none'),
      cborText('attStmt'),
      Buffer.from([0xa0]),
      cborText('authData'),
      cborBytes(authData),
    ]);
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(this.clientData('webauthn.create', challenge, origin)),
        attestationObject: b64u(attestation),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  get(challenge: string, { origin = ORIGIN, rpId = RP_ID, flags = 0x05, bump = true } = {}) {
    if (bump) this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counter]);
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
    };
  }
}

async function main() {
  const app = await buildApp();
  await app.ready();

  const mk = async (email: string, role: 'USER' | 'ADMIN' = 'USER') =>
    prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
  const ana = await mk('ana@x.io');
  await mk('adm@x.io', 'ADMIN');

  const headers = (cookie?: string, origin: string | null = ORIGIN) => ({
    ...(cookie ? { cookie } : {}),
    ...(origin ? { origin } : {}),
  });
  const passwordLogin = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const cAna = await passwordLogin('ana@x.io');
  const cAdm = await passwordLogin('adm@x.io');

  const post = (url: string, payload: object, cookie?: string, origin: string | null = ORIGIN) =>
    app.inject({ method: 'POST', url, headers: headers(cookie, origin), payload });

  /** Cadastra uma passkey; devolve o autenticador. */
  const enroll = async (cookie: string, name = 'Notebook') => {
    const device = new Authenticator();
    const opts = await post('/api/me/passkeys/options', { password: 'senha-123!' }, cookie);
    const { options, challengeId } = opts.json();
    const added = await post(
      '/api/me/passkeys',
      { challengeId, response: device.create(options.challenge), name },
      cookie,
    );
    return { device, opts, added };
  };
  /** Entra com a passkey. */
  const loginWith = async (device: Authenticator, tweak?: Parameters<Authenticator['get']>[1]) => {
    const o = await post('/api/auth/passkey/options', {});
    const { options, challengeId } = o.json();
    const res = await post('/api/auth/passkey/login', {
      challengeId,
      response: device.get(options.challenge, tweak),
    });
    return { res, challengeId, options };
  };

  // 1. Disponibilidade.
  let r = await app.inject({ method: 'GET', url: '/api/auth/options' });
  ok('a tela de login sabe que há passkeys', r.json().passkeys === true, r.json());
  r = await post('/api/auth/passkey/options', {}, undefined, null);
  ok('sem Origin (nem WEBAUTHN_ORIGIN) não há passkey', r.statusCode === 400, r.json());
  r = await post('/api/auth/passkey/options', {}, undefined, 'http://evil.example.com');
  ok('origem http fora do localhost não vale', r.statusCode === 400, r.json());
  r = await post('/api/me/passkeys/options', { password: 'senha-123!' });
  ok('cadastrar exige sessão', r.statusCode === 401, r.statusCode);

  // 2. Cadastro: pede a senha de novo.
  r = await post('/api/me/passkeys/options', { password: 'errada' }, cAna);
  ok('senha errada não abre o cadastro', r.statusCode === 400, r.json());
  const { device, opts, added } = await enroll(cAna);
  const optionsBody = opts.json().options;
  ok(
    'opções pedem credencial descobrível, com verificação do usuário',
    optionsBody.authenticatorSelection.residentKey === 'required' &&
      optionsBody.authenticatorSelection.userVerification === 'required' &&
      optionsBody.rp.id === RP_ID,
    optionsBody.authenticatorSelection,
  );
  ok('passkey cadastrada', added.statusCode === 201, added.json());
  r = await app.inject({ method: 'GET', url: '/api/me/passkeys', headers: headers(cAna) });
  ok(
    'a lista mostra a passkey, sem a chave',
    r.json().passkeys.length === 1 &&
      r.json().passkeys[0].name === 'Notebook' &&
      !('publicKey' in r.json().passkeys[0]),
    r.json(),
  );
  r = await app.inject({ method: 'GET', url: '/api/me/passkeys', headers: headers(cAdm) });
  ok('cada pessoa vê só as suas', r.json().passkeys.length === 0, r.json());
  ok(
    'o cadastro entra na auditoria',
    (await prisma.auditEvent.count({ where: { action: 'PASSKEY_ADDED', actorId: ana.id } })) === 1,
  );

  // 3. Desafio de cadastro: uma vez, so da mesma pessoa, so para o cadastro.
  const o2 = (await post('/api/me/passkeys/options', { password: 'senha-123!' }, cAna)).json();
  const other = new Authenticator();
  r = await post(
    '/api/me/passkeys',
    { challengeId: o2.challengeId, response: other.create(o2.options.challenge), name: 'Outro' },
    cAdm,
  );
  ok('desafio de outra pessoa não serve', r.statusCode === 400, r.json());
  r = await post(
    '/api/me/passkeys',
    { challengeId: o2.challengeId, response: other.create(o2.options.challenge), name: 'Outro' },
    cAna,
  );
  ok('o desafio gasto não serve de novo', r.statusCode === 400, r.json());
  const o3 = (await post('/api/me/passkeys/options', { password: 'senha-123!' }, cAna)).json();
  r = await post(
    '/api/me/passkeys',
    {
      challengeId: o3.challengeId,
      response: other.create(o3.options.challenge, 'http://localhost.evil.com'),
      name: 'Outro',
    },
    cAna,
  );
  ok('origem diferente no cadastro é recusada', r.statusCode === 400, r.json());
  r = await post('/api/me/passkeys/options', { password: 'senha-123!' }, cAna);
  const o4 = r.json();
  r = await post(
    '/api/me/passkeys',
    {
      challengeId: o4.challengeId,
      response: device.create(o4.options.challenge),
      name: 'Repetida',
    },
    cAna,
  );
  ok('a mesma credencial não entra duas vezes', r.statusCode >= 400, r.statusCode);

  // 4. Entrar com a passkey.
  let login = await loginWith(device);
  ok(
    'login com a passkey',
    login.res.statusCode === 200 && login.res.json().user.email === 'ana@x.io',
    login.res.json(),
  );
  const cookie = String(login.res.headers['set-cookie']).split(';')[0];
  r = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  ok(
    'a sessão da passkey vale',
    r.statusCode === 200 && r.json().user?.email === 'ana@x.io',
    r.statusCode,
  );
  ok(
    'o login marca o uso e avança o contador',
    (await prisma.passkey.findFirst({ where: { userId: ana.id } }))?.counter === device.counter,
  );

  // 5. Recusas.
  r = await post('/api/auth/passkey/login', {
    challengeId: login.challengeId,
    response: device.get(login.options.challenge),
  });
  ok('o mesmo desafio não entra de novo', r.statusCode === 401, r.json());

  login = await loginWith(device, { origin: 'http://localhost:9999' });
  ok('origem errada na assinatura', login.res.statusCode === 401, login.res.json());
  login = await loginWith(device, { rpId: 'evil.example.com' });
  ok('domínio errado na assinatura', login.res.statusCode === 401, login.res.json());
  login = await loginWith(device, { flags: 0x01 });
  ok(
    'sem verificação do usuário (só presença) não entra',
    login.res.statusCode === 401,
    login.res.json(),
  );
  device.counter = (await prisma.passkey.findFirstOrThrow({ where: { userId: ana.id } })).counter;
  login = await loginWith(device, { bump: false });
  ok('contador que não avança não entra', login.res.statusCode === 401, login.res.json());

  const stranger = new Authenticator();
  login = await loginWith(stranger);
  ok('passkey desconhecida', login.res.statusCode === 401, login.res.json());
  r = await post('/api/auth/passkey/login', {
    challengeId: 'nao-existe-nao-existe',
    response: { id: 'x' },
  });
  ok('desafio inexistente', r.statusCode === 401, r.json());
  ok(
    'as recusas entram na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'LOGIN_FAILED', targetLabel: 'passkey' },
    })) >= 4,
  );

  // 6. Conta suspensa nao entra.
  await prisma.user.update({ where: { id: ana.id }, data: { status: 'SUSPENDED' } });
  login = await loginWith(device);
  ok('conta suspensa não entra por passkey', login.res.statusCode === 403, login.res.json());
  await prisma.user.update({ where: { id: ana.id }, data: { status: 'ACTIVE' } });
  login = await loginWith(device);
  ok('reativada, volta a entrar', login.res.statusCode === 200, login.res.json());

  // 7. Conta do AD entra pelo AD.
  await prisma.user.update({
    where: { id: ana.id },
    data: { authSource: 'LDAP', ldapDn: 'cn=ana' },
  });
  login = await loginWith(device);
  ok('conta do AD não usa passkey', login.res.statusCode === 401, login.res.json());
  await prisma.user.update({ where: { id: ana.id }, data: { authSource: 'LOCAL', ldapDn: null } });

  // 8. 2FA: com ele ligado, cadastrar pede tambem o codigo; entrar com passkey dispensa.
  await prisma.user.update({ where: { id: ana.id }, data: { twoFactorEnabledAt: new Date() } });
  r = await post('/api/me/passkeys/options', { password: 'senha-123!' }, cookie);
  ok('com 2FA, cadastrar pede o código', r.statusCode === 400 && r.json().details?.code, r.json());
  login = await loginWith(device);
  ok(
    'a passkey vale por senha e 2FA',
    login.res.statusCode === 200 && !login.res.json().twoFactorRequired,
    login.res.json(),
  );
  await prisma.user.update({ where: { id: ana.id }, data: { twoFactorEnabledAt: null } });

  // 9. Renomear, remover.
  const mine = (await prisma.passkey.findFirst({ where: { userId: ana.id } }))!;
  r = await app.inject({
    method: 'PATCH',
    url: `/api/me/passkeys/${mine.id}`,
    headers: headers(cAna),
    payload: { name: 'Celular' },
  });
  ok(
    'renomear',
    r.statusCode === 200 &&
      (await prisma.passkey.findUnique({ where: { id: mine.id } }))?.name === 'Celular',
    r.json(),
  );
  r = await app.inject({
    method: 'DELETE',
    url: `/api/me/passkeys/${mine.id}`,
    headers: headers(cAdm),
  });
  ok('ninguém remove a passkey alheia', r.statusCode === 404, r.statusCode);
  r = await app.inject({
    method: 'DELETE',
    url: `/api/me/passkeys/${mine.id}`,
    headers: headers(cAna),
  });
  ok('remover', r.statusCode === 200, r.json());
  login = await loginWith(device);
  ok('removida, não entra mais', login.res.statusCode === 401, login.res.json());
  ok(
    'a remoção entra na auditoria',
    (await prisma.auditEvent.count({ where: { action: 'PASSKEY_REMOVED', actorId: ana.id } })) ===
      1,
  );

  // 10. Redefinicao de senha pelo admin derruba as passkeys.
  const again = await enroll(cookie, 'Segundo');
  ok('novo cadastro depois da remoção', again.added.statusCode === 201, again.added.json());
  r = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${ana.id}/reset-password`,
    headers: headers(cAdm),
  });
  ok('admin redefine a senha', r.statusCode === 200, r.json());
  ok(
    'e as passkeys da conta caem junto',
    (await prisma.passkey.count({ where: { userId: ana.id } })) === 0,
  );

  // 11. Teto por conta.
  const bob = await mk('bob@x.io');
  const cBob = await passwordLogin('bob@x.io');
  for (let i = 0; i < 10; i++) {
    await prisma.passkey.create({
      data: {
        userId: bob.id,
        credentialId: `fake-${i}`,
        publicKey: Buffer.from([1]),
        transports: [],
        deviceType: 'singleDevice',
        name: `p${i}`,
      },
    });
  }
  r = await post('/api/me/passkeys/options', { password: 'senha-123!' }, cBob);
  ok('teto de passkeys por conta', r.statusCode === 409, r.json());

  await app.close();
  await prisma.$disconnect();
  if (fails) {
    console.log(`\n${fails} falha(s)`);
    process.exit(1);
  }
  console.log('\nTodos os testes passaram.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
