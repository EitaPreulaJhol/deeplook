import { PrismaClient } from '@prisma/client';

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
export const prisma = new PrismaClient().$extends({
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
