import { env } from '../env';
import { type DataKeys, envKeys, needsRekey, rekey } from './data-key';
import { prisma } from './prisma';

const FIELDS = ['twoFactorSecret', 'twoFactorPendingSecret'] as const;

export type RekeyResult = {
  /** Valores recifrados com o DATA_KEY atual nesta rodada. */
  rekeyed: number;
  /** Valores que nenhuma chave do ambiente le (ficam como estao). */
  unreadable: number;
};

/**
 * Recifra com o DATA_KEY atual os segredos do 2FA que ainda estao sob outra chave: a do
 * SESSION_SECRET (v1) ou um DATA_KEY anterior. Sem DATA_KEY, nao faz nada. Cada valor so e
 * trocado se continuar igual ao que foi lido (a pessoa pode reconfigurar o 2FA no meio).
 */
export async function rekeyStoredSecrets(keys: DataKeys = envKeys()): Promise<RekeyResult> {
  const result: RekeyResult = { rekeyed: 0, unreadable: 0 };
  if (!keys.dataKey) return result;
  const users = await prisma.user.findMany({
    where: { OR: FIELDS.map((field) => ({ [field]: { not: null } })) },
    select: { id: true, twoFactorSecret: true, twoFactorPendingSecret: true },
  });
  for (const user of users) {
    for (const field of FIELDS) {
      const stored = user[field];
      if (!stored || !needsRekey(stored, keys)) continue;
      let next: string | null;
      try {
        next = rekey(stored, keys);
      } catch {
        result.unreadable += 1;
        continue;
      }
      if (!next) continue;
      const { count } = await prisma.user.updateMany({
        where: { id: user.id, [field]: stored },
        data: { [field]: next },
      });
      result.rekeyed += count;
    }
  }
  return result;
}

/** Quantos segredos ainda nao estao sob o DATA_KEY atual (para o status do sistema). */
export async function pendingRekey(keys: DataKeys = envKeys()): Promise<number> {
  if (!keys.dataKey) return 0;
  const users = await prisma.user.findMany({
    where: { OR: FIELDS.map((field) => ({ [field]: { not: null } })) },
    select: { twoFactorSecret: true, twoFactorPendingSecret: true },
  });
  return users
    .flatMap((u) => FIELDS.map((field) => u[field]))
    .filter((stored) => stored && needsRekey(stored, keys)).length;
}

/** Na subida: recifra em segundo plano e registra o resultado. Nunca rejeita. */
export async function startDataKeyRekey(log: {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}): Promise<void> {
  try {
    const result = await rekeyStoredSecrets();
    if (result.rekeyed) log.info(result, '[chave de dados] segredos do 2FA recifrados');
    if (result.unreadable) {
      log.warn(
        result,
        '[chave de dados] segredos do 2FA que nenhuma chave do ambiente lê (SESSION_SECRET ou ' +
          'DATA_KEY trocado sem o DATA_KEY_PREVIOUS): essas contas só entram com código de recuperação',
      );
    }
    if (env.DATA_KEY_PREVIOUS && !result.unreadable && !(await pendingRekey())) {
      log.info(
        {},
        '[chave de dados] nada mais sob a chave anterior: DATA_KEY_PREVIOUS pode sair do .env',
      );
    }
  } catch (err) {
    log.error({ err }, '[chave de dados] falha ao recifrar');
  }
}
