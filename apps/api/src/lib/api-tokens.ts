import crypto from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { ApiTokenScope } from '../generated/prisma/client';
import type { PublicUser, RoleName } from './auth';
import { passwordState } from './password-policy';
import { resolvePreferences } from './preferences';
import { prisma } from './prisma';

/** Prefixo dos tokens (facilita reconhecer um token vazado em logs e repositorios). */
export const TOKEN_PREFIX = 'dlk_';
/** Validade maxima de um token e quantos ativos cada usuario pode ter. */
export const TOKEN_MAX_DAYS = 90;
export const TOKEN_MAX_ACTIVE = 10;
/** Requisicoes por minuto por token. */
const RATE_PER_MINUTE = 120;
/** Ultimo uso gravado no maximo uma vez por minuto (menos escrita no banco). */
const LAST_USED_EVERY_MS = 60_000;

/**
 * Rotas do escopo SAMPLES: so enviar e consultar amostras. Triagem, relatorios,
 * administracao, conta e download do arquivo continuam so pelo navegador.
 */
export const ALLOWED_ROUTES = new Set([
  // Especificacao OpenAPI destas rotas (item 93).
  'GET /api/openapi.json',
  'POST /api/entries/file',
  'POST /api/entries/url',
  'POST /api/entries/zip',
  'GET /api/entries',
  'GET /api/entries/:id',
  'GET /api/entries/:id/reports',
  'GET /api/entries/:id/events',
  'GET /api/entries/:id/iocs',
  'GET /api/entries/:id/iocs/export',
  'GET /api/entries/:id/reputation',
  'GET /api/entries/:id/antivirus',
]);

/**
 * Rotas do escopo STATUS (item 3.2): so a leitura do status do sistema, para um monitor externo
 * (Uptime Kuma, Zabbix). Fica FORA de ALLOWED_ROUTES de proposito: aquela lista e a da
 * especificacao OpenAPI de quem integra amostras, e cada escopo alcanca so as suas rotas.
 */
export const STATUS_ROUTES = new Set(['GET /api/status']);

/** Escopos que alcancam a rota; vazio = a rota nao aceita token. */
export function scopesFor(route: string): ApiTokenScope[] {
  const scopes: ApiTokenScope[] = [];
  if (ALLOWED_ROUTES.has(route)) scopes.push('SAMPLES');
  if (STATUS_ROUTES.has(route)) scopes.push('STATUS');
  return scopes;
}

export function newTokenSecret(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** So o hash vai para o banco; o token em si aparece uma unica vez. */
export function hashToken(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Token do cabecalho `Authorization: Bearer ...`; null sem cabecalho ou com
 * outro esquema (segue para o cookie); '' se o Bearer vier malformado.
 */
export function bearerOf(req: FastifyRequest): string | null {
  const header = req.headers.authorization?.trim();
  if (!header || !/^Bearer\b/i.test(header)) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : '';
}

export type TokenAuth = { ok: true; user: PublicUser } | { ok: false; code: number; error: string };

const windows = new Map<string, { start: number; count: number }>();

function overRate(tokenId: string, now: number): boolean {
  const w = windows.get(tokenId);
  if (!w || now - w.start >= 60_000) {
    windows.set(tokenId, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    return false;
  }
  w.count += 1;
  return w.count > RATE_PER_MINUTE;
}

/**
 * Autentica a requisicao pelo token. Recusa rota fora das listas, token
 * desconhecido, revogado ou vencido, conta suspensa, token de outro escopo e
 * usuario sem a liberacao "Acesso por API" (dada manualmente por um admin).
 */
export async function authenticateToken(req: FastifyRequest, secret: string): Promise<TokenAuth> {
  const route = `${req.method} ${req.routeOptions.url ?? ''}`;
  const scopes = scopesFor(route);
  if (!scopes.length) {
    return {
      ok: false,
      code: 403,
      error: 'Esta rota não aceita token de API (só envio e consulta de amostras).',
    };
  }
  const invalid = { ok: false as const, code: 401, error: 'Token de API inválido ou expirado.' };
  if (!secret.startsWith(TOKEN_PREFIX)) return invalid;

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(secret) },
    include: { user: true },
  });
  const now = Date.now();
  if (!token || token.revokedAt || token.expiresAt.getTime() <= now) return invalid;
  const u = token.user;
  if (u.status !== 'ACTIVE') return invalid;
  // So depois de provar que o token e valido: quem erra o token nao descobre os escopos.
  if (!scopes.includes(token.scope)) {
    return {
      ok: false,
      code: 403,
      error:
        token.scope === 'STATUS'
          ? 'Este token só consulta o status do sistema (GET /api/status).'
          : 'Este token não vale para esta rota.',
    };
  }
  // O token de status e de um administrador: se a conta deixou de ser, o token para de valer.
  if (token.scope === 'STATUS' && u.role !== 'ADMIN') {
    return {
      ok: false,
      code: 403,
      error: 'O dono deste token deixou de ser administrador.',
    };
  }
  const password = passwordState(u);
  if (password.mustChangePassword) {
    return {
      ok: false,
      code: 403,
      error:
        password.passwordChangeReason === 'expired'
          ? 'A senha da conta expirou: defina uma nova pelo navegador antes de usar a API.'
          : 'A conta precisa definir uma nova senha (redefinida pelo admin) antes de usar a API.',
    };
  }
  if (!u.apiAccess) {
    return { ok: false, code: 403, error: 'O acesso por API desta conta não está liberado.' };
  }
  if (overRate(token.id, now)) {
    return {
      ok: false,
      code: 429,
      error: 'Limite de requisições do token atingido. Aguarde 1 minuto.',
    };
  }

  if (
    !token.lastUsedAt ||
    now - token.lastUsedAt.getTime() >= LAST_USED_EVERY_MS ||
    token.lastUsedIp !== req.ip
  ) {
    await prisma.apiToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date(now), lastUsedIp: req.ip },
    });
  }

  return {
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role as RoleName,
      status: 'ACTIVE',
      createdAt: u.createdAt,
      apiAccess: true,
      ...password,
      twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
      ldap: u.authSource === 'LDAP',
      away: u.away,
      preferences: resolvePreferences(u.preferences),
    },
  };
}
