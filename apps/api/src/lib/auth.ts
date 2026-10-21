import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../env';
import { type Preferences, resolvePreferences } from './preferences';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'dl_session';

export type RoleName = 'USER' | 'ANALYST' | 'ADMIN';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: RoleName;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
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

  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role as RoleName,
    status: u.status as 'ACTIVE' | 'SUSPENDED',
    createdAt: u.createdAt,
    preferences: resolvePreferences(u.preferences),
  };
}

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);
  const session = await prisma.session.create({ data: { userId, expiresAt } });

  reply.setCookie(SESSION_COOKIE, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE === 'true',
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
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
  const user = await loadUser(req);
  if (!user) {
    unauthorized(reply);
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
