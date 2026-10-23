import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { createSession, currentSession, destroySession, loadUser } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { passwordField, passwordState } from '../lib/password-policy';
import { resolvePreferences } from '../lib/preferences';
import { prisma } from '../lib/prisma';
import { attemptLimit } from '../lib/rate-limit';
import { newChallenge, readChallenge } from '../lib/two-factor';
import { sendValidationError } from '../lib/validation';
import { checkSecondFactor } from './two-factor';

const RegisterSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(80),
  password: passwordField,
  activationKey: z.string().min(6),
});

const TwoFactorSchema = z.object({
  challenge: z.string().min(10).max(300),
  code: z.string().trim().min(6).max(20),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: Date;
  apiAccess: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
  twoFactorEnabledAt: Date | null;
  preferences: unknown;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    apiAccess: u.apiAccess,
    ...passwordState(u),
    twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
    preferences: resolvePreferences(u.preferences),
  };
}

/** Pausa que separa duas visitas: abrir o app depois disso conta como nova visita. */
const VISIT_GAP_MS = 30 * 60 * 1000;

/**
 * Registra a atividade do usuario. Se a ultima atividade foi ha mais de 30 min,
 * ela vira a "visita anterior" (base dos avisos da Pagina Inicial).
 */
async function touchVisit(userId: string): Promise<void> {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastSeenAt: true },
  });
  const now = new Date();
  const last = record?.lastSeenAt;
  const newVisit = !last || now.getTime() - last.getTime() > VISIT_GAP_MS;
  await prisma.user.update({
    where: { id: userId },
    data: newVisit ? { previousSeenAt: last ?? null, lastSeenAt: now } : { lastSeenAt: now },
  });
}

export async function authRoutes(app: FastifyInstance) {
  // Cadastro somente via chave de ativacao gerada por um admin.
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { email, displayName, password, activationKey } = parsed.data;

    const key = await prisma.activationKey.findUnique({
      where: { code: activationKey.trim().toUpperCase() },
    });

    if (!key) return reply.code(400).send({ error: 'Chave de ativacao invalida.' });
    if (key.revoked) return reply.code(400).send({ error: 'Chave de ativacao revogada.' });
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'Chave de ativacao expirada.' });
    }
    if (key.usesUsed >= key.maxUses) {
      return reply.code(400).send({ error: 'Chave de ativacao ja utilizada.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.code(409).send({ error: 'E-mail ja cadastrado.' });

    const passwordHash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          displayName,
          passwordHash,
          role: key.role,
          status: 'ACTIVE',
        },
      });
      await tx.activationKey.update({
        where: { id: key.id },
        data: {
          usesUsed: { increment: 1 },
          usedBy: { connect: { id: created.id } },
        },
      });
      await audit(tx, req, {
        action: 'USER_REGISTERED',
        actorId: created.id,
        targetUserId: created.id,
        targetLabel: normalizedEmail,
        detail: `chave ${key.code} · papel ${key.role}`,
      });
      return created;
    });

    await createSession(reply, user.id, req);
    return reply.code(201).send({ user: publicUser(user) });
  });

  // 5 tentativas a cada 5 min por e-mail (ver lib/rate-limit.ts).
  const loginEmail = (req: { body?: unknown }) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '-';
  };
  const loginLimit = attemptLimit((req) => `login:${loginEmail(req)}`, {
    // Bloqueio por excesso de tentativas entra na auditoria (uma vez por janela).
    onExceeded: (req) => {
      void audit(prisma, req, {
        action: 'LOGIN_LOCKED',
        actorId: null,
        targetLabel: loginEmail(req),
        detail: '5 tentativas em 5 min',
      }).catch((err) => req.log.error({ err }, 'Falha ao auditar bloqueio de login'));
    },
  });
  // Login recusado: registra o e-mail tentado e o motivo (nunca a senha).
  const loginFailed = (req: FastifyRequest, email: string, userId: string | null, reason: string) =>
    audit(prisma, req, {
      action: 'LOGIN_FAILED',
      actorId: null,
      targetUserId: userId,
      targetLabel: email,
      detail: reason,
    });

  app.post('/api/auth/login', { config: loginLimit }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const normalized = email.trim().toLowerCase();
    if (!user) {
      await loginFailed(req, normalized, null, 'e-mail não cadastrado');
      return reply.code(401).send({ error: 'Credenciais invalidas.' });
    }
    if (user.status !== 'ACTIVE') {
      await loginFailed(req, normalized, user.id, 'conta suspensa');
      return reply.code(403).send({ error: 'Conta suspensa.' });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await loginFailed(req, normalized, user.id, 'senha incorreta');
      return reply.code(401).send({ error: 'Credenciais invalidas.' });
    }

    // 2FA: a senha esta certa, mas a sessao so nasce depois do codigo.
    if (user.twoFactorEnabledAt) {
      return reply.send({ twoFactorRequired: true, challenge: newChallenge(user.id) });
    }

    await createSession(reply, user.id, req);
    return reply.send({ user: publicUser(user) });
  });

  // Segunda etapa do login com 2FA: codigo do aplicativo ou de recuperacao.
  const twoFactorLimit = attemptLimit(
    (req) => {
      const challenge = (req.body as { challenge?: unknown } | undefined)?.challenge;
      return `2fa:${typeof challenge === 'string' ? (readChallenge(challenge) ?? '-') : '-'}`;
    },
    {
      onExceeded: (req) => {
        const challenge = (req.body as { challenge?: unknown } | undefined)?.challenge;
        const userId = typeof challenge === 'string' ? readChallenge(challenge) : null;
        void audit(prisma, req, {
          action: 'LOGIN_LOCKED',
          actorId: null,
          targetUserId: userId,
          detail: '5 códigos 2FA errados em 5 min',
        }).catch((err) => req.log.error({ err }, 'Falha ao auditar bloqueio do 2FA'));
      },
    },
  );

  app.post('/api/auth/login/2fa', { config: twoFactorLimit }, async (req, reply) => {
    const parsed = TwoFactorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
    const userId = readChallenge(parsed.data.challenge);
    if (!userId) {
      return reply.code(401).send({ error: 'A verificação expirou. Entre novamente.' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || !user.twoFactorEnabledAt) {
      return reply.code(401).send({ error: 'A verificação expirou. Entre novamente.' });
    }
    const factor = await checkSecondFactor(prisma, user.id, parsed.data.code);
    if (!factor.ok) {
      await loginFailed(
        req,
        user.email,
        user.id,
        factor.broken ? '2FA ilegível (SESSION_SECRET trocado?)' : 'código 2FA incorreto',
      );
      return reply.code(401).send({
        error: factor.broken
          ? 'O 2FA desta conta precisa ser reconfigurado. Use um código de recuperação ou peça a um administrador para desativá-lo.'
          : 'Código inválido.',
      });
    }
    if (factor.via === 'recovery') {
      await audit(prisma, req, {
        action: 'TWO_FACTOR_RECOVERY_USED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: `login com código de recuperação · restam ${factor.remaining}`,
      });
    }
    await createSession(reply, user.id, req);
    return reply.send({ user: publicUser(user), recoveryRemaining: factor.remaining ?? null });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.send({ ok: true });
  });

  // Atividade do usuario (teclado/mouse no front): renova a sessao por mais
  // SESSION_IDLE_MINUTES e devolve a nova validade.
  app.post('/api/auth/touch', async (req, reply) => {
    const session = await currentSession(req, true);
    if (!session) return reply.code(401).send({ error: 'Sessao expirada.' });
    return reply.send({ expiresAt: session.expiresAt });
  });

  // Validade atual sem renovar (o front confere antes de avisar/encerrar,
  // pois outra janela pode ter renovado a sessao).
  app.get('/api/auth/session', async (req, reply) => {
    const session = await currentSession(req, false);
    if (!session) return reply.code(401).send({ error: 'Sessao expirada.' });
    return reply.send({ expiresAt: session.expiresAt });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await loadUser(req);
    if (!user) return reply.code(401).send({ error: 'Nao autenticado.' });
    await touchVisit(user.id);
    return reply.send({ user });
  });
}
