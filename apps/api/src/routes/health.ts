import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';
import { describeError } from '../lib/status';

/**
 * Saude da API (item 1.2 do plano de melhorias), nos dois papeis de sempre:
 *
 * - `/api/health` e **liveness**: o processo esta de pe e responde. Nao toca em
 *   dependencia nenhuma, para que uma queda do banco nao faca o orquestrador
 *   reiniciar uma API que esta sa.
 * - `/api/health/ready` e **readiness**: Postgres e MinIO respondem, entao da
 *   para atender pedido de verdade. E o que o `healthcheck` do compose usa;
 *   sem ele, a API aparecia `healthy` com o banco fora e o `web` liberava o
 *   trafego para quem nao tinha como responder.
 *
 * As duas rotas ficam **sem autenticacao**: o Docker consulta antes de existir
 * sessao. Por isso a resposta traz so o nome da dependencia e se ela respondeu
 * — o motivo da falha vai para o log da API, e o detalhe completo (endereco,
 * latencia, versoes) continua so em Administracao > Status.
 */

/** Tempo-limite por dependencia: um servico travado nao segura a sonda. */
const TIMEOUT_MS = 2000;
/**
 * A rota e publica e consulta banco e MinIO, entao o resultado vale por um
 * instante: uma enxurrada de sondas nao vira uma enxurrada de consultas, e o
 * `interval: 15s` do compose nem percebe.
 */
const CACHE_MS = 1000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

interface Probe {
  name: 'database' | 'storage';
  ok: boolean;
  /** So para o log: nunca entra na resposta. */
  reason?: string;
}

async function probe(name: Probe['name'], fn: () => Promise<unknown>): Promise<Probe> {
  try {
    await withTimeout(fn());
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, reason: describeError(err) };
  }
}

let cached: { at: number; checks: Probe[] } | null = null;

async function readiness(): Promise<Probe[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.checks;
  const checks = await Promise.all([
    probe('database', () => prisma.$queryRaw`SELECT 1`),
    probe('storage', () => s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }))),
  ]);
  cached = { at: Date.now(), checks };
  return checks;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'deeplook-api',
    time: new Date().toISOString(),
  }));

  app.get('/api/health/ready', async (req, reply) => {
    const checks = await readiness();
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) {
      // O motivo so no log: a rota e publica e a mensagem do driver carrega
      // endereco e, as vezes, usuario do banco.
      req.log.warn(
        { checks: failed.map((c) => ({ name: c.name, reason: c.reason })) },
        'readiness: dependencia fora',
      );
    }

    return reply.code(failed.length ? 503 : 200).send({
      status: failed.length ? 'degraded' : 'ok',
      service: 'deeplook-api',
      time: new Date().toISOString(),
      checks: checks.map((c) => ({ name: c.name, ok: c.ok })),
    });
  });
}
