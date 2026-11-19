import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { createSession, requireUser } from '../lib/auth';
import { verifyPassword } from '../lib/crypto';
import {
  MAX_PASSKEYS,
  relyingParty,
  RP_NAME,
  storeChallenge,
  takeChallenge,
} from '../lib/passkeys';
import { prisma } from '../lib/prisma';
import { attemptLimit, sessionKey } from '../lib/rate-limit';
import { sendValidationError } from '../lib/validation';
import { publicUser } from './auth';
import { checkSecondFactor } from './two-factor';

const NameSchema = z.string().trim().min(1).max(60);
const ChallengeId = z.string().min(10).max(60);
/** O navegador devolve um objeto grande; a biblioteca confere o conteudo, aqui so o formato. */
const WebAuthnResponse = z.object({ id: z.string().min(1).max(1400) }).loose();

const OptionsSchema = z.object({
  password: z.string().min(1),
  /** Codigo do 2FA, so se a conta o usa. */
  code: z.string().trim().min(6).max(20).optional(),
});
const AddSchema = z.object({
  challengeId: ChallengeId,
  response: WebAuthnResponse,
  name: NameSchema,
});
const LoginSchema = z.object({ challengeId: ChallengeId, response: WebAuthnResponse });

const UNAVAILABLE = {
  error: 'Passkeys indisponíveis neste endereço. Use o endereço do DeepLook com HTTPS.',
};
const INVALID = { error: 'Credenciais inválidas.' };

const toTransports = (values: string[]) => values as AuthenticatorTransport[];

/** Minha Conta > Passkeys (cadastro) e o login com passkey. */
export async function passkeyRoutes(app: FastifyInstance) {
  // Entrar: pedido anonimo, entao o limite e por IP. Cada tentativa gasta um desafio no banco.
  const loginLimit = attemptLimit((req) => `passkey:${req.ip}`, { max: 20 });
  // Cadastro: por sessao; cada passkey gasta dois pedidos (opcoes e resposta).
  const manageLimit = attemptLimit(sessionKey('passkey-add'), { max: 10 });

  // Mesmo formato do loginFailed de auth.ts; o "e-mail" e a via, ja que a passkey nao informa um.
  const loginFailed = (req: FastifyRequest, via: string, userId: string | null, reason: string) =>
    audit(prisma, req, {
      action: 'LOGIN_FAILED',
      actorId: null,
      targetUserId: userId,
      targetLabel: via,
      detail: reason,
    });

  // ---- Entrar -------------------------------------------------------------------------------

  // Sem allowCredentials: a passkey e "descobrivel", o aparelho mostra as contas e a credencial
  // diz quem e. Nao revela se um e-mail existe.
  app.post('/api/auth/passkey/options', { config: loginLimit }, async (req, reply) => {
    const rp = relyingParty(req);
    if (!rp) return reply.code(400).send(UNAVAILABLE);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'required',
    });
    const challengeId = await storeChallenge(prisma, options.challenge, 'login', null);
    return reply.send({ options, challengeId });
  });

  app.post('/api/auth/passkey/login', { config: loginLimit }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos.' });
    const rp = relyingParty(req);
    if (!rp) return reply.code(400).send(UNAVAILABLE);

    const challenge = await takeChallenge(prisma, parsed.data.challengeId, 'login', null);
    if (!challenge) {
      return reply
        .code(401)
        .send({ error: 'A verificação expirou. Tente de novo.', code: 'PASSKEY_EXPIRED' });
    }
    const passkey = await prisma.passkey.findUnique({
      where: { credentialId: parsed.data.response.id },
      include: { user: true },
    });
    if (!passkey) {
      await loginFailed(req, 'passkey', null, 'passkey desconhecida');
      return reply.code(401).send(INVALID);
    }
    const user = passkey.user;

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: parsed.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: toTransports(passkey.transports),
        },
      });
    } catch (err) {
      req.log.info({ err }, 'Passkey recusada');
      await loginFailed(req, 'passkey', user.id, 'assinatura da passkey recusada');
      return reply.code(401).send(INVALID);
    }
    if (!verification.verified) {
      await loginFailed(req, 'passkey', user.id, 'assinatura da passkey recusada');
      return reply.code(401).send(INVALID);
    }
    // Conta do AD entra pelo AD (os grupos definem o papel a cada login).
    if (user.authSource !== 'LOCAL') {
      await loginFailed(req, 'passkey', user.id, 'conta do AD com passkey');
      return reply.code(401).send(INVALID);
    }
    if (user.status !== 'ACTIVE') {
      await loginFailed(req, 'passkey', user.id, 'conta suspensa');
      return reply.code(403).send({ error: 'Conta suspensa.' });
    }

    // O contador so sobe: dois logins ao mesmo tempo com a mesma passkey nao passam juntos.
    const { newCounter } = verification.authenticationInfo;
    const advanced = await prisma.passkey.updateMany({
      where: {
        id: passkey.id,
        ...(newCounter > 0 ? { counter: { lt: newCounter } } : {}),
      },
      data: { counter: newCounter, lastUsedAt: new Date() },
    });
    if (advanced.count === 0) {
      await loginFailed(
        req,
        'passkey',
        user.id,
        'contador da passkey não avançou (credencial clonada?)',
      );
      return reply.code(401).send(INVALID);
    }

    if (!(await createSession(reply, user, req))) {
      await loginFailed(req, 'passkey', user.id, 'senha trocada durante o login');
      return reply.code(401).send(INVALID);
    }
    return reply.send({ user: publicUser(user) });
  });

  // ---- Minha Conta --------------------------------------------------------------------------

  app.get('/api/me/passkeys', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await prisma.passkey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        deviceType: true,
        backedUp: true,
      },
    });
    return reply.send({ passkeys: rows, available: !user.ldap, max: MAX_PASSKEYS });
  });

  // Passo 1: pede as opcoes. Como a passkey passa a entrar na conta sem senha, quem tem so a
  // sessao (cookie roubado) nao pode cadastrar uma: confirma a senha e, com 2FA, o codigo.
  app.post('/api/me/passkeys/options', { config: manageLimit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.ldap) {
      return reply.code(403).send({ error: 'Contas do AD entram pelo AD, sem passkey.' });
    }
    const parsed = OptionsSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const record = await prisma.user.findUnique({ where: { id: user.id } });
    if (!record || !(await verifyPassword(parsed.data.password, record.passwordHash))) {
      return reply
        .code(400)
        .send({ error: 'Dados inválidos.', details: { password: ['senha incorreta'] } });
    }
    if (user.twoFactorEnabled) {
      const factor = parsed.data.code
        ? await checkSecondFactor(prisma, user.id, parsed.data.code)
        : { ok: false as const };
      if (!factor.ok) {
        return reply
          .code(400)
          .send({ error: 'Dados inválidos.', details: { code: ['código inválido'] } });
      }
    }
    const rp = relyingParty(req);
    if (!rp) return reply.code(400).send(UNAVAILABLE);
    const existing = await prisma.passkey.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });
    if (existing.length >= MAX_PASSKEYS) {
      return reply.code(409).send({ error: `Limite de ${MAX_PASSKEYS} passkeys por conta.` });
    }
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rp.rpID,
      userName: user.email,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id),
      // Sem atestado: nao interessa qual aparelho e, so que a chave e dele.
      attestationType: 'none',
      // Sem repetir o mesmo aparelho; descobrivel e com verificacao do usuario: entra sem e-mail.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: toTransports(c.transports),
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const challengeId = await storeChallenge(prisma, options.challenge, 'register', user.id);
    return reply.send({ options, challengeId });
  });

  // Passo 2: confere a resposta do aparelho e guarda a chave publica.
  app.post('/api/me/passkeys', { config: manageLimit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.ldap) {
      return reply.code(403).send({ error: 'Contas do AD entram pelo AD, sem passkey.' });
    }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const rp = relyingParty(req);
    if (!rp) return reply.code(400).send(UNAVAILABLE);
    const challenge = await takeChallenge(prisma, parsed.data.challengeId, 'register', user.id);
    if (!challenge) {
      return reply
        .code(400)
        .send({ error: 'A verificação expirou. Tente de novo.', code: 'PASSKEY_EXPIRED' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      req.log.info({ err }, 'Cadastro de passkey recusado');
      return reply.code(400).send({ error: 'Não foi possível cadastrar esta passkey.' });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'Não foi possível cadastrar esta passkey.' });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const created = await prisma.$transaction(async (tx) => {
      if ((await tx.passkey.count({ where: { userId: user.id } })) >= MAX_PASSKEYS) return null;
      const row = await tx.passkey.create({
        data: {
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: parsed.data.name,
        },
      });
      await audit(tx, req, {
        action: 'PASSKEY_ADDED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: `${parsed.data.name} · ${credentialDeviceType}`,
      });
      return row;
    });
    if (!created) {
      return reply.code(409).send({ error: `Limite de ${MAX_PASSKEYS} passkeys por conta.` });
    }
    return reply.code(201).send({ id: created.id });
  });

  app.patch('/api/me/passkeys/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ name: NameSchema }).safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { count } = await prisma.passkey.updateMany({
      where: { id, userId: user.id },
      data: { name: parsed.data.name },
    });
    if (!count) return reply.code(404).send({ error: 'Passkey não encontrada.' });
    return reply.send({ ok: true });
  });

  app.delete('/api/me/passkeys/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const removed = await prisma.$transaction(async (tx) => {
      const row = await tx.passkey.findFirst({ where: { id, userId: user.id } });
      if (!row) return false;
      await tx.passkey.delete({ where: { id } });
      await audit(tx, req, {
        action: 'PASSKEY_REMOVED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: row.name,
      });
      return true;
    });
    if (!removed) return reply.code(404).send({ error: 'Passkey não encontrada.' });
    return reply.send({ ok: true });
  });
}
