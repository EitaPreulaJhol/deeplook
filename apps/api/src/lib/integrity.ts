import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';

import type { FastifyRequest } from 'fastify';

import { audit } from './audit';
import { log } from './log';
import { prisma } from './prisma';

/**
 * Conferencia de integridade do arquivo guardado (item 4.2 do plano de melhorias): o objeto
 * no MinIO tem de ter o SHA-256 (e o tamanho) que a ficha gravou no envio. Pega corrupcao
 * silenciosa do armazenamento e adulteracao do bucket por fora da API.
 *
 * Duas portas de entrada: o download (`hashingStream`, que confere enquanto os bytes passam,
 * sem ler duas vezes) e o job de scrub (`integrity-scrub.ts`, que le em segundo plano).
 */

/** O que a conferencia precisa saber da amostra. */
export interface IntegrityTarget {
  id: string;
  title: string;
  ownerId: string;
  sha256: string;
  fileSize: number | null;
}

export type IntegrityOutcome =
  { state: 'ok' } | { state: 'mismatch'; actual: string; bytes: number } | { state: 'missing' };

/** Quem pediu a conferencia (vai para a auditoria e para o log). */
export interface IntegritySource {
  via: 'download' | 'scrub';
  /** Quem baixou; null no scrub (o sistema). */
  actorId?: string | null;
  req?: FastifyRequest | null;
}

/**
 * Deixa os bytes passarem e calcula o SHA-256 e o tamanho no caminho. `onEnd` so roda se o
 * fluxo terminou inteiro: um download abortado destroi o stream e o `flush` nunca chega,
 * entao meia leitura nao vira veredito (nem falso alarme). O fim do fluxo espera o registro,
 * para quem recebeu o ultimo byte ja encontrar o resultado gravado; se o registro falhar,
 * so vai para o log, porque o download em si deu certo.
 */
export function hashingStream(
  onEnd: (result: { sha256: string; bytes: number }) => Promise<void>,
): Transform {
  const hash = createHash('sha256');
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
    flush(callback) {
      onEnd({ sha256: hash.digest('hex'), bytes })
        .catch((err: unknown) =>
          log.error({ err }, '[integridade] nao consegui registrar o resultado da conferencia'),
        )
        .finally(() => callback());
    },
  });
}

/** Compara o que foi lido com o que a ficha gravou: o mesmo hash e, se ha, o mesmo tamanho. */
export function judge(
  target: IntegrityTarget,
  read: { sha256: string; bytes: number },
): IntegrityOutcome {
  const sameHash = read.sha256 === target.sha256.toLowerCase();
  const sameSize = target.fileSize === null || read.bytes === target.fileSize;
  return sameHash && sameSize
    ? { state: 'ok' }
    : { state: 'mismatch', actual: read.sha256, bytes: read.bytes };
}

const VIA: Record<IntegritySource['via'], string> = {
  download: 'no download',
  scrub: 'na verificação periódica',
};

/**
 * Grava o resultado. A auditoria so sai na MUDANCA de estado (passou a divergir, ou voltou a
 * conferir): rodadas seguintes sobre o mesmo arquivo estragado nao enchem a trilha. A troca
 * de estado e um UPDATE condicional, entao duas conferencias ao mesmo tempo nao auditam duas
 * vezes. Amostra na lixeira nao e tocada (o filtro do Prisma a esconde).
 */
export async function recordIntegrity(
  target: IntegrityTarget,
  outcome: IntegrityOutcome,
  source: IntegritySource,
): Promise<void> {
  const now = new Date();
  const base = {
    actorId: source.actorId ?? null,
    targetUserId: target.ownerId,
    targetLabel: target.title,
  };

  if (outcome.state === 'ok') {
    const restored = await prisma.entry.updateMany({
      where: { id: target.id, integrityFailedAt: { not: null } },
      data: { integrityFailedAt: null, integrityCheckedAt: now },
    });
    if (restored.count) {
      await audit(prisma, source.req ?? null, {
        ...base,
        action: 'ENTRY_INTEGRITY_RESTORED',
        detail: `${VIA[source.via]}: o arquivo voltou a conferir com o SHA-256 ${target.sha256}`,
      });
      log.info({ entryId: target.id }, '[integridade] o arquivo voltou a conferir');
    } else {
      await prisma.entry.updateMany({
        where: { id: target.id },
        data: { integrityCheckedAt: now },
      });
    }
    return;
  }

  const flagged = await prisma.entry.updateMany({
    where: { id: target.id, integrityFailedAt: null },
    data: { integrityFailedAt: now, integrityCheckedAt: now },
  });
  if (!flagged.count) {
    // Ja estava marcada: so atualiza a data da ultima leitura.
    await prisma.entry.updateMany({ where: { id: target.id }, data: { integrityCheckedAt: now } });
    return;
  }
  const detail =
    outcome.state === 'missing'
      ? `${VIA[source.via]}: o objeto não está no armazenamento`
      : `${VIA[source.via]}: SHA-256 esperado ${target.sha256}, calculado ${outcome.actual} ` +
        `(${outcome.bytes} bytes lidos; a ficha diz ${target.fileSize ?? 'sem tamanho'})`;
  await audit(prisma, source.req ?? null, { ...base, action: 'ENTRY_INTEGRITY_FAILED', detail });
  log.error(
    { entryId: target.id, state: outcome.state },
    '[integridade] o arquivo guardado nao confere com a ficha',
  );
}
