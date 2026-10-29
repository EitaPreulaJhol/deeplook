import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { createSession, currentSession, destroySession, loadUser } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { ldapAuthenticate, ldapConfig } from '../lib/ldap';
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
  /** E-mail; com o AD ligado (item 94), tambem o usuario do AD. */
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
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
  authSource: string;
  away: boolean;
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
    ldap: u.authSource === 'LDAP',
    away: u.away,
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

  /**
   * Conta local de quem entrou pelo AD: criada no primeiro acesso, com nome,
   * e-mail e papel (pelos grupos) atualizados a cada login. Null se o e-mail do
   * AD ja e de uma conta local (nao assume a conta de outra pessoa).
   */
  const ldapAccount = async (
    req: FastifyRequest,
    ad: { dn: string; email: string; name: string; role: 'USER' | 'ANALYST' | 'ADMIN' },
  ) => {
    const existing =
      (await prisma.user.findUnique({ where: { ldapDn: ad.dn } })) ??
      (await prisma.user.findUnique({ where: { email: ad.email } }));
    if (existing?.authSource === 'LOCAL') return null;
    if (!existing) {
      return prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: ad.email,
            displayName: ad.name.slice(0, 120),
            role: ad.role,
            authSource: 'LDAP',
            ldapDn: ad.dn,
            // Nunca confere: a senha e a do AD.
            passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          },
        });
        await audit(tx, req, {
          action: 'USER_REGISTERED',
          actorId: created.id,
          targetUserId: created.id,
          targetLabel: created.email,
          detail: `primeiro acesso pelo AD · ${ad.role}`,
        });
        return created;
      });
    }
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { displayName: ad.name.slice(0, 120), email: ad.email, ldapDn: ad.dn, role: ad.role },
    });
    if (existing.role !== ad.role) {
      await audit(prisma, req, {
        action: 'USER_ROLE_CHANGED',
        actorId: null,
        targetUserId: existing.id,
        targetLabel: updated.email,
        detail: `${existing.role} → ${ad.role} (grupos do AD)`,
      });
    }
    return updated;
  };

  app.post('/api/auth/login', { config: loginLimit }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
    const { email, password } = parsed.data;

    const normalized = email.toLowerCase();
    const local = await prisma.user.findUnique({ where: { email: normalized } });
    let user = local;
    if (local?.authSource === 'LOCAL') {
      if (local.status !== 'ACTIVE') {
        await loginFailed(req, normalized, local.id, 'conta suspensa');
        return reply.code(403).send({ error: 'Conta suspensa.' });
      }
      if (!(await verifyPassword(password, local.passwordHash))) {
        await loginFailed(req, normalized, local.id, 'senha incorreta');
        return reply.code(401).send({ error: 'Credenciais invalidas.' });
      }
    } else if (ldapConfig()) {
      // AD (item 94): sem conta local, ou conta do AD. A mesma mensagem para tudo.
      const result = await ldapAuthenticate(email, password);
      if (!result.ok) {
        await loginFailed(req, normalized, local?.id ?? null, result.reason);
        return reply.code(401).send({ error: 'Credenciais invalidas.' });
      }
      user = await ldapAccount(req, result);
      if (!user) {
        await loginFailed(req, normalized, null, `e-mail do AD (${result.email}) já é de uma conta local`);
        return reply.code(401).send({ error: 'Credenciais invalidas.' });
      }
      // Suspensa no DeepLook nao entra, mesmo com a senha certa no AD.
      if (user.status !== 'ACTIVE') {
        await loginFailed(req, normalized, user.id, 'conta suspensa');
        return reply.code(403).send({ error: 'Conta suspensa.' });
      }
    } else {
      await loginFailed(
        req,
        normalized,
        local?.id ?? null,
        local ? 'conta do AD com o AD desligado' : 'e-mail não cadastrado',
      );
      return reply.code(401).send({ error: 'Credenciais invalidas.' });
    }
    if (!user) return reply.code(401).send({ error: 'Credenciais invalidas.' });

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

  // Tela de login (item 94): com o AD ligado, o campo aceita o usuario do AD.
  app.get('/api/auth/options', async (_req, reply) => reply.send({ ldap: Boolean(ldapConfig()) }));

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
