import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../env';
import { authenticateToken, bearerOf, hashToken } from './api-tokens';
import { randomToken } from './crypto';
import { network } from './network';
import { type PasswordChangeReason, passwordState } from './password-policy';
import { type Preferences, resolvePreferences } from './preferences';
import { prisma } from './prisma';
import { ownSamplesOnly } from './settings';

/**
 * Sob HTTPS (COOKIE_SECURE), o prefixo __Host- obriga o navegador a aceitar o cookie so do
 * proprio host, com Secure e Path=/: outro subdominio do mesmo dominio nao consegue gravar
 * nem trocar a sessao de quem usa o DeepLook (cookie tossing / fixacao de sessao).
 */
export const SESSION_COOKIE = env.COOKIE_SECURE === 'true' ? '__Host-dl_session' : 'dl_session';
const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE === 'true',
} as const;

/**
 * O cookie leva o segredo; o banco guarda so o SHA-256 dele, como nos tokens de API. Assim o
 * banco e o backup (pg_dump) nao entregam sessoes validas a quem os ler.
 */
export function sessionIdOf(token: string): string {
  return hashToken(token);
}

/** Id (o hash) da sessao do cookie deste pedido, ou null. */
export function sessionIdFrom(req: FastifyRequest): string | null {
  const token = (req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  return token ? sessionIdOf(token) : null;
}

/** Apaga o cookie da sessao (o __Host- so e apagado com os mesmos atributos). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}

/** Intervalo minimo entre duas gravacoes do ultimo acesso da sessao. */
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

export type RoleName = 'USER' | 'ANALYST' | 'ADMIN';

/**
 * So o proxy da rede confiavel (o nginx) informa o IP do cliente; o nginx substitui o
 * X-Forwarded-For, entao o cliente nao o forja (item 112). A faixa vem de TRUSTED_NETWORK
 * (src/lib/network.ts); sem ela, qualquer rede privada, como antes.
 */
export const TRUST_PROXY = network.trustProxy;

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
  const sid = sessionIdFrom(req);
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

/**
 * Abre a sessao de quem acabou de provar a senha. `user.passwordHash` e o hash que foi
 * conferido: se a senha mudou desde entao, nao abre (false). A conta fica travada ate a
 * sessao gravar, entao uma troca de senha ao mesmo tempo ou termina antes (e aqui o hash
 * nao confere) ou espera e apaga esta sessao junto com as outras. Sem isso, um login
 * no meio da troca ganhava uma sessao que sobrevivia a ela.
 */
export async function createSession(
  reply: FastifyReply,
  user: { id: string; passwordHash: string },
  req: FastifyRequest,
): Promise<boolean> {
  const expiresAt = slidingExpiry(new Date());
  const userAgent = req.headers['user-agent']?.slice(0, 300) ?? null;
  // O valor do cookie: aleatorio, nao o cuid padrao (previsivel em boa parte). O banco
  // guarda so o hash dele.
  const token = randomToken(32);
  const session = await prisma.$transaction(async (tx) => {
    const current = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User"
      WHERE "id" = ${user.id} AND "passwordHash" = ${user.passwordHash}
      FOR UPDATE`;
    if (!current.length) return null;
    return tx.session.create({
      data: { id: sessionIdOf(token), userId: user.id, expiresAt, userAgent, ip: req.ip ?? null },
    });
  });
  if (!session) return false;

  reply.setCookie(SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
  return true;
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
  const sid = sessionIdFrom(req);
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
  const sid = sessionIdFrom(req);
  if (sid) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
  }
  clearSessionCookie(reply);
}

/** Sessoes vencidas (item 118): sem isto, so sairiam se a pessoa voltasse com o cookie. */
export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}

export function startSessionCleanup(log: { error: (obj: object, msg: string) => void }) {
  const run = () =>
    deleteExpiredSessions().catch((err: unknown) =>
      log.error({ err }, '[sessoes] falha na limpeza'),
    );
  void run();
  setInterval(() => void run(), 60 * 60 * 1000).unref();
}

export function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: 'Nao autenticado.' });
}

export function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: 'Acesso negado.' });
}

/**
 * Amostras que a pessoa pode ver (item 140): filtro para somar ao `where`. Vazio,
 * a nao ser para o usuario comum com a restricao ligada.
 */
export async function visibleEntries(user: PublicUser): Promise<{ ownerId?: string }> {
  return !isAnalyst(user) && (await ownSamplesOnly()) ? { ownerId: user.id } : {};
}

/**
 * Com a restricao ligada, o usuario comum nao ve de quem e duplicata nem de onde veio
 * uma amostra, se a outra for de outra pessoa (item 140). `isDuplicate` mantem o aviso
 * de duplicata na lista, que antes vinha do id.
 */
export async function linksForViewer<
  T extends { duplicateOfId?: string | null; parentEntryId?: string | null },
>(entries: T[], user: PublicUser): Promise<(T & { isDuplicate?: boolean })[]> {
  const { ownerId } = await visibleEntries(user);
  if (!ownerId) return entries as (T & { isDuplicate?: boolean })[];
  const ids = entries.flatMap((e) => [e.duplicateOfId, e.parentEntryId]).filter((v) => v);
  const own = new Set(
    (
      await prisma.entry.findMany({
        where: { id: { in: ids as string[] }, ownerId },
        select: { id: true },
      })
    ).map((e) => e.id),
  );
  const shown = (id: string | null | undefined) => (id && own.has(id) ? id : null);
  return entries.map((e) => ({
    ...e,
    duplicateOfId: shown(e.duplicateOfId),
    parentEntryId: shown(e.parentEntryId),
    isDuplicate: Boolean(e.duplicateOfId),
  }));
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<PublicUser | null> {
  const user = await authenticate(req, reply);
  if (!user) return null;
  // Toda rota de uma amostra passa por aqui, inclusive as que ainda vao existir. O 404
  // nao revela que a amostra existe (item 140).
  if (req.routeOptions.url?.startsWith('/api/entries/:id')) {
    const { ownerId } = await visibleEntries(user);
    if (ownerId) {
      const { id } = req.params as { id: string };
      if (!(await prisma.entry.count({ where: { id, ownerId } }))) {
        reply.code(404).send({ error: 'Amostra não encontrada.' });
        return null;
      }
    }
  }
  return user;
}

async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<PublicUser | null> {
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

/**
 * E-mail de quem enviou (item 123): so para analistas, administradores e a
 * propria pessoa; usuarios comuns veem o nome.
 */
export function ownerForViewer<T extends { owner: { id: string; email?: string } }>(
  entry: T,
  viewer: PublicUser,
): T {
  if (isAnalyst(viewer) || entry.owner.id === viewer.id) return entry;
  const { email: _email, ...owner } = entry.owner;
  return { ...entry, owner };
}
