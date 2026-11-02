import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { audit } from '../lib/audit';
import { createSession, currentSession, destroySession, loadUser } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { ldapAccountsGone, ldapAuthenticate, ldapConfig, sameDn } from '../lib/ldap';
import { passwordField, passwordState } from '../lib/password-policy';
import { resolvePreferences } from '../lib/preferences';
import { isUniqueViolation, prisma } from '../lib/prisma';
import { PUBLIC_ADMIN_PASSWORDS } from '../lib/public-defaults';
import { attemptLimit, FailureWindow } from '../lib/rate-limit';
import { closeSessionsOf } from '../lib/sandbox';
import { credentialMark, newChallenge, readChallenge } from '../lib/two-factor';
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

const DEVICE_COOKIE = 'dl_device';
const DEVICE_COOKIE_DAYS = 90;

/** Chave usada ate o limite por outro cadastro ao mesmo tempo (item 111). */
class KeyUsedUp extends Error {}

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

/** Fora de producao, ou com ALLOW_INSECURE_DEFAULTS=true (demonstracao), a senha padrao entra. */
const publicPasswordRefused = (password: string) =>
  env.NODE_ENV === 'production' &&
  env.ALLOW_INSECURE_DEFAULTS !== 'true' &&
  PUBLIC_ADMIN_PASSWORDS.includes(password);

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
  // Chave de ativacao nao e testada a vontade (item 113).
  const registerLimit = attemptLimit((req) => `register:${req.ip}`, { max: 10 });
  app.post('/api/auth/register', { config: registerLimit }, async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { email, displayName, password, activationKey } = parsed.data;

    const key = await prisma.activationKey.findUnique({
      where: { code: activationKey.trim().toUpperCase() },
    });

    if (!key) return reply.code(400).send({ error: 'Chave de ativação inválida.' });
    if (key.revoked) return reply.code(400).send({ error: 'Chave de ativação revogada.' });
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'Chave de ativação expirada.' });
    }
    if (key.usesUsed >= key.maxUses) {
      return reply.code(400).send({ error: 'Chave de ativação já utilizada.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.code(409).send({ error: 'E-mail já cadastrado.' });

    const passwordHash = await hashPassword(password);

    const user = await prisma
      .$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: normalizedEmail,
            displayName,
            passwordHash,
            role: key.role,
            status: 'ACTIVE',
          },
        });
        // A conferencia acima pode estar velha: so conta se ainda houver uso (item 111).
        const { count } = await tx.activationKey.updateMany({
          where: { id: key.id, usesUsed: { lt: key.maxUses } },
          data: { usesUsed: { increment: 1 } },
        });
        if (!count) throw new KeyUsedUp();
        await tx.activationKey.update({
          where: { id: key.id },
          data: { usedBy: { connect: { id: created.id } } },
        });
        await audit(tx, req, {
          action: 'USER_REGISTERED',
          actorId: created.id,
          targetUserId: created.id,
          targetLabel: normalizedEmail,
          detail: `chave ${key.code} · papel ${key.role}`,
        });
        return created;
      })
      .catch((err: unknown) => {
        if (err instanceof KeyUsedUp || isUniqueViolation(err)) return err as Error;
        throw err;
      });
    if (user instanceof KeyUsedUp) {
      return reply.code(400).send({ error: 'Chave de ativação já utilizada.' });
    }
    if (user instanceof Error) return reply.code(409).send({ error: 'E-mail já cadastrado.' });

    if (!(await createSession(reply, user, req))) {
      return reply.code(409).send({ error: 'A conta mudou durante o cadastro. Entre novamente.' });
    }
    return reply.code(201).send({ user: publicUser(user) });
  });

  // 5 tentativas a cada 5 min por e-mail (ver lib/rate-limit.ts).
  const loginEmail = (req: { body?: unknown }) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '-';
  };
  // Por e-mail + IP (item 113): de outro IP, ninguem bloqueia a conta alheia. Os dois
  // abaixo seguram o resto: muitas contas de um IP e uma conta de muitos IPs.
  const failuresByIp = new FailureWindow(30, 5 * 60 * 1000);
  const failuresByEmail = new FailureWindow(20, 5 * 60 * 1000);
  /**
   * Navegador onde a conta ja entrou: cookie assinado, que so existe depois da senha
   * certa. Quem o tem nao para na janela por e-mail, e assim ninguem de fora tranca a
   * conta alheia com falhas de varios IPs; o limite por e-mail + IP continua valendo.
   */
  const knownDevice = (req: FastifyRequest, userId: string | undefined) => {
    const raw = req.cookies[DEVICE_COOKIE];
    if (!raw || !userId) return false;
    const { valid, value } = req.unsignCookie(raw);
    return valid && value === userId;
  };
  const rememberDevice = (reply: FastifyReply, userId: string) =>
    reply.setCookie(DEVICE_COOKIE, userId, {
      path: '/api/auth',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE === 'true',
      signed: true,
      maxAge: DEVICE_COOKIE_DAYS * 24 * 3600,
    });
  // Quem nao existe tambem custa um bcrypt: o tempo nao revela o cadastro.
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  const loginLimit = attemptLimit((req) => `login:${loginEmail(req)}:${req.ip}`, {
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
  const loginFailed = (
    req: FastifyRequest,
    email: string,
    userId: string | null,
    reason: string,
  ) => {
    failuresByIp.note(req.ip);
    failuresByEmail.note(email);
    return recordLoginFailure(req, email, userId, reason);
  };
  const recordLoginFailure = (
    req: FastifyRequest,
    email: string,
    userId: string | null,
    reason: string,
  ) =>
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
    if (existing?.authSource === 'LOCAL') {
      return { refused: `e-mail do AD (${ad.email}) já é de uma conta local` };
    }
    // E-mail de uma conta ligada a outro DN: so a mesma pessoa se o DN antigo nao existe
    // mais (mudou de OU). Senao, seria outra conta do AD assumindo a identidade desta.
    const moved = existing?.ldapDn && !sameDn(existing.ldapDn, ad.dn) ? existing.ldapDn : null;
    if (moved) {
      const gone = await ldapAccountsGone([moved]).catch(() => null);
      if (!gone?.has(moved)) {
        return { refused: `e-mail do AD (${ad.email}) já é de outra conta do AD (${moved})` };
      }
    }
    if (!existing) {
      const created = await prisma
        .$transaction(async (tx) => {
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
        })
        .catch((err: unknown) => {
          if (!isUniqueViolation(err)) throw err;
          return null;
        });
      // Dois primeiros acessos ao mesmo tempo: vale a conta que o outro criou (item 110).
      if (created) return created;
      return prisma.user.findUnique({ where: { ldapDn: ad.dn } });
    }
    const data = { displayName: ad.name.slice(0, 120), ldapDn: ad.dn, role: ad.role };
    // E-mail novo que ja e de outra conta: entra com o antigo em vez de dar erro (item 110).
    const updated = await prisma.user
      .update({ where: { id: existing.id }, data: { ...data, email: ad.email } })
      .catch((err: unknown) => {
        if (!isUniqueViolation(err)) throw err;
        req.log.warn({ dn: ad.dn }, 'E-mail do AD já é de outra conta; mantido o atual');
        return prisma.user.update({ where: { id: existing.id }, data });
      });
    if (moved) {
      await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: existing.id } });
        await tx.apiToken.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit(tx, req, {
          action: 'USER_LDAP_RELINKED',
          actorId: null,
          targetUserId: existing.id,
          targetLabel: updated.email,
          detail: `${moved} → ${ad.dn}`,
        });
      });
    }
    if (existing.role !== ad.role) {
      await audit(prisma, req, {
        action: 'USER_ROLE_CHANGED',
        actorId: null,
        targetUserId: existing.id,
        targetLabel: updated.email,
        detail: `${existing.role} → ${ad.role} (grupos do AD)`,
      });
      if (ad.role === 'USER') closeSessionsOf(existing.id, req.log);
    }
    return updated;
  };

  app.post('/api/auth/login', { config: loginLimit }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos.' });
    const { email, password } = parsed.data;

    const normalized = email.toLowerCase();
    if (failuresByIp.exceeded(req.ip)) {
      return reply.code(429).send({ error: 'Muitas tentativas. Tente novamente em 5 minutos.' });
    }
    const local = await prisma.user.findUnique({ where: { email: normalized } });
    if (failuresByEmail.exceeded(normalized) && !knownDevice(req, local?.id)) {
      return reply.code(429).send({ error: 'Muitas tentativas. Tente novamente em 5 minutos.' });
    }
    let user = local;
    if (local?.authSource === 'LOCAL') {
      if (!(await verifyPassword(password, local.passwordHash))) {
        await loginFailed(req, normalized, local.id, 'senha incorreta');
        return reply.code(401).send({ error: 'Credenciais inválidas.' });
      }
      // So depois da senha certa: "suspensa" nao revela a conta a quem nao a conhece.
      if (local.status !== 'ACTIVE') {
        await loginFailed(req, normalized, local.id, 'conta suspensa');
        return reply.code(403).send({ error: 'Conta suspensa.' });
      }
      // Senha padrao do admin (publica): quem chegasse primeiro trocaria a senha e ficaria
      // com o admin. Em producao so entra depois de o .env trazer uma senha propria.
      if (publicPasswordRefused(password)) {
        await loginFailed(req, normalized, local.id, 'senha padrão pública');
        return reply.code(403).send({
          error:
            'Esta conta usa a senha padrão, que é pública, e o login com ela está bloqueado. ' +
            'Defina ADMIN_PASSWORD no .env e reinicie a API (o admin entra com ela e define ' +
            'outra no primeiro acesso), ou peça a outro administrador para redefinir a senha.',
          code: 'PUBLIC_DEFAULT_PASSWORD',
        });
      }
    } else if (ldapConfig()) {
      // AD (item 94): sem conta local, ou conta do AD. A mesma mensagem para tudo.
      const result = await ldapAuthenticate(email, password);
      if (!result.ok) {
        await loginFailed(req, normalized, local?.id ?? null, result.reason);
        return reply.code(401).send({ error: 'Credenciais inválidas.' });
      }
      const account = await ldapAccount(req, result);
      if (account && 'refused' in account) {
        await loginFailed(req, normalized, null, account.refused);
        return reply.code(401).send({ error: 'Credenciais inválidas.' });
      }
      user = account;
      if (!user) return reply.code(401).send({ error: 'Credenciais inválidas.' });
      // Suspensa no DeepLook nao entra, mesmo com a senha certa no AD.
      if (user.status !== 'ACTIVE') {
        await loginFailed(req, normalized, user.id, 'conta suspensa');
        return reply.code(403).send({ error: 'Conta suspensa.' });
      }
    } else {
      await verifyPassword(password, await dummyHash);
      await loginFailed(
        req,
        normalized,
        local?.id ?? null,
        local ? 'conta do AD com o AD desligado' : 'e-mail não cadastrado',
      );
      return reply.code(401).send({ error: 'Credenciais inválidas.' });
    }
    if (!user) return reply.code(401).send({ error: 'Credenciais inválidas.' });

    // 2FA: a senha esta certa, mas a sessao so nasce depois do codigo.
    if (user.twoFactorEnabledAt) {
      return reply.send({
        twoFactorRequired: true,
        challenge: newChallenge(user.id, user.passwordHash),
      });
    }

    // A senha mudou enquanto esta era conferida: a senha usada ja nao vale.
    if (!(await createSession(reply, user, req))) {
      await loginFailed(req, normalized, user.id, 'senha trocada durante o login');
      return reply.code(401).send({ error: 'Credenciais inválidas.' });
    }
    rememberDevice(reply, user.id);
    return reply.send({ user: publicUser(user) });
  });

  // Segunda etapa do login com 2FA: codigo do aplicativo ou de recuperacao.
  const twoFactorLimit = attemptLimit(
    (req) => {
      const challenge = (req.body as { challenge?: unknown } | undefined)?.challenge;
      return `2fa:${typeof challenge === 'string' ? (readChallenge(challenge)?.userId ?? '-') : '-'}`;
    },
    {
      onExceeded: (req) => {
        const challenge = (req.body as { challenge?: unknown } | undefined)?.challenge;
        const userId =
          typeof challenge === 'string' ? (readChallenge(challenge)?.userId ?? null) : null;
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
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos.' });
    const challenge = readChallenge(parsed.data.challenge);
    if (!challenge) {
      return reply.code(401).send({ error: 'A verificação expirou. Entre novamente.' });
    }
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    // Senha trocada depois do desafio: a etapa da senha precisa ser refeita.
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !user.twoFactorEnabledAt ||
      credentialMark(user.passwordHash) !== challenge.mark
    ) {
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
    if (!(await createSession(reply, user, req))) {
      return reply.code(401).send({ error: 'A verificação expirou. Entre novamente.' });
    }
    rememberDevice(reply, user.id);
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
    if (!session) return reply.code(401).send({ error: 'Sessão expirada.' });
    return reply.send({ expiresAt: session.expiresAt });
  });

  // Tela de login (item 94): com o AD ligado, o campo aceita o usuario do AD.
  app.get('/api/auth/options', async (_req, reply) => reply.send({ ldap: Boolean(ldapConfig()) }));

  // Validade atual sem renovar (o front confere antes de avisar/encerrar,
  // pois outra janela pode ter renovado a sessao).
  app.get('/api/auth/session', async (req, reply) => {
    const session = await currentSession(req, false);
    if (!session) return reply.code(401).send({ error: 'Sessão expirada.' });
    return reply.send({ expiresAt: session.expiresAt });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await loadUser(req);
    if (!user) return reply.code(401).send({ error: 'Nao autenticado.' });
    await touchVisit(user.id);
    return reply.send({ user });
  });
}
