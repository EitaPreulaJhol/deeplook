import type { FastifyRequest } from 'fastify';

import { env } from '../env';
import type { Db } from './prisma';

/**
 * Passkeys (WebAuthn) como login alternativo. A pessoa cadastra em Minha Conta, ja com a conta
 * criada e a sessao aberta; depois entra so com a passkey (sem senha). A verificacao do usuario
 * (biometria ou PIN do aparelho) e obrigatoria, entao a passkey vale por senha e segundo fator:
 * entrar com ela nao pede o codigo do 2FA.
 */

export const RP_NAME = 'DeepLook';
/** Validade do desafio entre pedir as opcoes e responder. */
export const PASSKEY_CHALLENGE_MS = 5 * 60 * 1000;
/** Passkeys por conta: o teto evita uma lista sem fim. */
export const MAX_PASSKEYS = 10;

export type RelyingParty = { rpID: string; origins: string[] };

const isLocalHost = (host: string) => host === 'localhost' || host.endsWith('.localhost');

/** Aceita https (ou http so em localhost, para desenvolvimento) e devolve a origem normalizada. */
function normalizeOrigin(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Dominio e origens esperados. Com WEBAUTHN_ORIGIN, so valem as configuradas; sem ele, a origem
 * da propria requisicao (a credencial fica amarrada ao dominio onde foi criada, entao uma pagina
 * de outro dominio nao a usa). Null = passkeys indisponiveis para este pedido.
 */
export function relyingParty(req: Pick<FastifyRequest, 'headers'>): RelyingParty | null {
  const configured = env.WEBAUTHN_ORIGIN.split(',')
    .map(normalizeOrigin)
    .filter((u): u is URL => u !== null);
  if (env.WEBAUTHN_ORIGIN.trim()) {
    if (!configured.length) return null;
    return {
      rpID: env.WEBAUTHN_RP_ID.trim() || configured[0].hostname,
      origins: configured.map((u) => u.origin),
    };
  }
  const origin = normalizeOrigin(String(req.headers.origin ?? ''));
  if (!origin) return null;
  return { rpID: env.WEBAUTHN_RP_ID.trim() || origin.hostname, origins: [origin.origin] };
}

/** Guarda um desafio de uso unico e varre os vencidos. */
export async function storeChallenge(
  db: Db,
  challenge: string,
  purpose: 'register' | 'login',
  userId: string | null,
): Promise<string> {
  await db.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const row = await db.passkeyChallenge.create({
    data: {
      challenge,
      purpose,
      userId,
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_MS),
    },
  });
  return row.id;
}

/**
 * Consome o desafio: some na primeira leitura (resposta repetida nao vale) e so serve ao mesmo
 * proposito e, no cadastro, a mesma pessoa. Null se nao existe, venceu ou foi usado.
 */
export async function takeChallenge(
  db: Db,
  id: string,
  purpose: 'register' | 'login',
  userId: string | null,
): Promise<string | null> {
  const row = await db.passkeyChallenge.findUnique({ where: { id } });
  if (!row) return null;
  const { count } = await db.passkeyChallenge.deleteMany({ where: { id } });
  if (count === 0) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (row.purpose !== purpose || row.userId !== userId) return null;
  return row.challenge;
}
