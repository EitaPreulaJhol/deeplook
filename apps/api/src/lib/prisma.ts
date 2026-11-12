import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

/**
 * Conexao com o Postgres pelo driver `pg` (Prisma 7 exige um driver adapter).
 * O `pg` nao tem tempo-limite de conexao por padrao: 5 s, como no Prisma 6.
 */
/** Violacao de unicidade do Prisma (dois pedidos gravando o mesmo valor). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/** Serializa "conferir e gravar" ate o fim da transacao (item 111). */
export async function advisoryLock(tx: Tx, key: number): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

/** Operacoes de Entry que leem (ou alteram em massa) e respeitam a lixeira. */
const LIVE_ONLY = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'groupBy',
  'aggregate',
  'updateMany',
]);

/**
 * Cliente do Prisma com a lixeira aplicada: consultas de Entry ignoram as
 * amostras com `deletedAt`, a menos que o proprio `where` fale de `deletedAt`
 * (a aba Lixeira pede `deletedAt: { not: null }`). Relacoes aninhadas (ex.:
 * favoritos -> entry) nao passam por aqui e filtram `entry.deletedAt` na rota.
 */
export const prisma = createPrismaClient().$extends({
  query: {
    entry: {
      $allOperations({ operation, args, query }) {
        if (!LIVE_ONLY.has(operation)) return query(args);
        const a = args as { where?: Record<string, unknown> };
        if (a.where && 'deletedAt' in a.where) return query(args);
        a.where = { ...a.where, deletedAt: null };
        return query(args);
      },
    },
  },
});

/** Transacao do cliente acima (`prisma.$transaction(async (tx) => ...)`). */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Cliente ou transacao em andamento. */
export type Db = Tx | typeof prisma;
