import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../env';
import { authenticateToken, bearerOf } from './api-tokens';
import { type PasswordChangeReason, passwordState } from './password-policy';
import { type Preferences, resolvePreferences } from './preferences';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'dl_session';
/** Intervalo minimo entre duas gravacoes do ultimo acesso da sessao. */
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

export type RoleName = 'USER' | 'ANALYST' | 'ADMIN';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: RoleName;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
  /** Acesso por API liberado por um admin (tokens pessoais). */
  apiAccess: boolean;
  /** Precisa definir uma senha nova antes de usar o sistema (redefinida ou vencida). */
  mustChangePassword: boolean;
  /** Por que: senha redefinida pelo admin ou vencida pela politica (item 51). */
  passwordChangeReason: PasswordChangeReason;
  /** Validade da senha (null para admins ou sem validade). */
  passwordExpiresAt: Date | null;
  /** 2FA (TOTP) ativo na conta. */
  twoFactorEnabled: boolean;
  /** Conta do AD/LDAP (item 94): sem senha local. */
  ldap: boolean;
  /** Ausente: fora do rodizio da atribuicao automatica (item 72). */
  away: boolean;
  preferences: Preferences;
};

export async function loadUser(req: FastifyRequest): Promise<PublicUser | null> {
  const sid = (req as any).cookies?.[SESSION_COOKIE];
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
    return null;
  }

  const u = session.user;
  if (u.status !== 'ACTIVE') return null;

  // Ultimo acesso da sessao (aba Sessoes): no maximo uma escrita a cada 5 min.
  if (Date.now() - session.lastSeenAt.getTime() >= LAST_SEEN_EVERY_MS || session.ip !== req.ip) {
    void prisma.session
      .update({ where: { id: sid }, data: { lastSeenAt: new Date(), ip: req.ip ?? session.ip } })
      .catch(() => undefined);
  }

  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role as RoleName,
    status: u.status as 'ACTIVE' | 'SUSPENDED',
    createdAt: u.createdAt,
    apiAccess: u.apiAccess,
    ...passwordState(u),
    twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
    ldap: u.authSource === 'LDAP',
    away: u.away,
    preferences: resolvePreferences(u.preferences),
  };
}

/** Rotas liberadas enquanto a senha (redefinida ou vencida) nao for trocada. */
const PASSWORD_CHANGE_ROUTES = new Set(['POST /api/me/password']);

/**
 * Validade da sessao: N minutos sem atividade (SESSION_IDLE_MINUTES), nunca
 * alem do teto absoluto (SESSION_TTL_HOURS desde a criacao).
 */
function slidingExpiry(createdAt: Date, now = Date.now()): Date {
  const idle = now + env.SESSION_IDLE_MINUTES * 60_000;
  const ceiling = createdAt.getTime() + env.SESSION_TTL_HOURS * 3600 * 1000;
  return new Date(Math.min(idle, ceiling));
}

export async function createSession(
  reply: FastifyReply,
  userId: string,
  req: FastifyRequest,
): Promise<void> {
  const expiresAt = slidingExpiry(new Date());
  const userAgent = req.headers['user-agent']?.slice(0, 300) ?? null;
  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent, ip: req.ip ?? null },
  });

  reply.setCookie(SESSION_COOKIE, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE === 'true',
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
}

/**
 * Sessao atual (pelo cookie). Com `renew`, registra atividade do usuario e
 * empurra a validade (so o login e POST /api/auth/touch renovam: consultas
 * automaticas do front, como polling, nao contam como atividade).
 */
export async function currentSession(
  req: FastifyRequest,
  renew: boolean,
): Promise<{ expiresAt: Date } | null> {
  const sid = (req as any).cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: { select: { status: true } } },
  });
  if (!session || session.user.status !== 'ACTIVE') return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!renew) return { expiresAt: session.expiresAt };

  const expiresAt = slidingExpiry(session.createdAt);
  await prisma.session.update({ where: { id: sid }, data: { expiresAt } });
  return { expiresAt };
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = (req as any).cookies?.[SESSION_COOKIE];
  if (sid) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: 'Nao autenticado.' });
}

export function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: 'Acesso negado.' });
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<PublicUser | null> {
  // Script com token de API (Authorization: Bearer): so nas rotas liberadas.
  const bearer = bearerOf(req);
  if (bearer !== null) {
    const auth = await authenticateToken(req, bearer);
    if (!auth.ok) {
      reply.code(auth.code).send({ error: auth.error });
      return null;
    }
    return auth.user;
  }
  const user = await loadUser(req);
  if (!user) {
    unauthorized(reply);
    return null;
  }
  if (
    user.mustChangePassword &&
    !PASSWORD_CHANGE_ROUTES.has(`${req.method} ${req.routeOptions.url ?? ''}`)
  ) {
    reply.code(403).send({
      error: 'Defina uma nova senha para continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return null;
  }
  return user;
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<PublicUser | null> {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== 'ADMIN') {
    reply.code(403).send({ error: 'Acesso restrito a administradores.' });
    return null;
  }
  return user;
}

export function isAnalyst(user: PublicUser): boolean {
  return user.role === 'ANALYST' || user.role === 'ADMIN';
}
