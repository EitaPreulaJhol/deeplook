import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { IocKind } from '../generated/prisma/client';
import { allowedBy, invalidateAllowlist, loadAllowlist } from '../lib/allowlist';
import { audit } from '../lib/audit';
import type { PublicUser } from '../lib/auth';
import { isAnalyst, requireUser } from '../lib/auth';
import type { ImportTarget } from '../lib/ioc-import';
import { IMPORT_MAX_ITEMS, ImportError, parseImport, validateImported } from '../lib/ioc-import';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

/** Indicadores seguidos por usuario (mesmo limite do botao Seguir). */
export const WATCH_LIMIT = 200;

const Target = z.enum(['watch', 'allow']);
const PreviewSchema = z.object({
  target: Target,
  text: z.string().min(1, 'cole a lista ou escolha um arquivo'),
});
const ImportSchema = z.object({
  target: Target,
  items: z
    .array(z.object({ kind: z.string(), value: z.string().max(300) }))
    .min(1, 'nada para importar')
    .max(IMPORT_MAX_ITEMS),
  /** Motivo (obrigatorio na lista de permissoes). */
  reason: z.string().trim().max(300).optional(),
});

/** Situacao de um indicador reconhecido em relacao ao destino. */
type Status = 'new' | 'exists' | 'covered' | 'limit';

/**
 * Importar indicadores (item 78): lista em CSV/texto ou pacote STIX 2.1 para
 * seguir (alertas de IOC, por usuario) ou para a lista de permissoes
 * (analistas). Primeiro a pre-visualizacao (o que foi reconhecido, o que ja
 * existe e o que e invalido); depois a confirmacao com os escolhidos.
 */
export async function iocImportRoutes(app: FastifyInstance) {
  /** Usuario que pode importar para o destino; em erro ja responde e devolve null. */
  const allowedUser = async (req: FastifyRequest, reply: FastifyReply, target: ImportTarget) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (target === 'allow' && !isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas mantêm a lista de permissões.' });
      return null;
    }
    return user;
  };

  /** Situacao de cada indicador no destino (e vagas, ao seguir). */
  const statuses = async (
    user: PublicUser,
    target: ImportTarget,
    items: { kind: IocKind; value: string }[],
  ) => {
    const result = new Map<string, Status>();
    if (target === 'watch') {
      const watched = await prisma.iocWatch.findMany({
        where: { userId: user.id },
        select: { kind: true, value: true },
      });
      const have = new Set(watched.map((w) => `${w.kind}:${w.value}`));
      let room = Math.max(0, WATCH_LIMIT - watched.length);
      for (const i of items) {
        const key = `${i.kind}:${i.value}`;
        if (have.has(key)) result.set(key, 'exists');
        else if (room > 0) {
          result.set(key, 'new');
          room--;
        } else result.set(key, 'limit');
      }
      return { result, room: Math.max(0, WATCH_LIMIT - watched.length) };
    }
    const list = await loadAllowlist();
    for (const i of items) {
      const by = allowedBy(list, i.kind, i.value);
      const key = `${i.kind}:${i.value}`;
      result.set(key, !by ? 'new' : by === key ? 'exists' : 'covered');
    }
    return { result, room: null };
  };

  app.post('/api/iocs/import/preview', async (req, reply) => {
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { target, text } = parsed.data;
    const user = await allowedUser(req, reply, target);
    if (!user) return;
    let data;
    try {
      data = parseImport(text, target);
    } catch (err) {
      if (err instanceof ImportError) {
        return reply.code(400).send({ error: err.message, details: { text: [err.message] } });
      }
      throw err;
    }
    const { result, room } = await statuses(user, target, data.items);
    const items = data.items.map((i) => ({ ...i, status: result.get(`${i.kind}:${i.value}`)! }));
    const counts = { new: 0, exists: 0, covered: 0, limit: 0 };
    for (const i of items) counts[i.status]++;
    return reply.send({
      format: data.format,
      items,
      invalid: data.invalid,
      repeated: data.repeated,
      counts,
      room,
    });
  });

  app.post('/api/iocs/import', async (req, reply) => {
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { target, reason } = parsed.data;
    const user = await allowedUser(req, reply, target);
    if (!user) return;
    if (target === 'allow' && (!reason || reason.length < 3)) {
      return reply.code(400).send({
        error: 'Dados invalidos.',
        details: { reason: ['diga por que esses indicadores são legítimos (3 a 300 caracteres)'] },
      });
    }

    // Valida de novo (o cliente pode mandar qualquer coisa) e tira repetidos.
    const valid = new Map<string, { kind: IocKind; value: string }>();
    let rejected = 0;
    for (const item of parsed.data.items) {
      const kind = item.kind as IocKind;
      const checked = ['IPV4', 'DOMAIN', 'EMAIL', 'MD5', 'SHA1', 'SHA256'].includes(kind)
        ? validateImported(kind, item.value, target)
        : { reason: 'tipo inválido' };
      if ('reason' in checked) rejected++;
      else
        valid.set(`${checked.kind}:${checked.value}`, { kind: checked.kind, value: checked.value });
    }
    const { result } = await statuses(user, target, [...valid.values()]);
    const fresh = [...valid.values()].filter((i) => result.get(`${i.kind}:${i.value}`) === 'new');

    let added = 0;
    if (target === 'watch') {
      added = (
        await prisma.iocWatch.createMany({
          data: fresh.map((i) => ({ userId: user.id, ...i })),
          skipDuplicates: true,
        })
      ).count;
    } else if (fresh.length) {
      added = await prisma.$transaction(async (tx) => {
        const { count } = await tx.allowedIndicator.createMany({
          data: fresh.map((i) => ({ ...i, reason: reason!, createdById: user.id })),
          skipDuplicates: true,
        });
        await audit(tx, req, {
          action: 'ALLOWLIST_IMPORTED',
          actorId: user.id,
          targetLabel: `${count} indicador(es)`,
          detail: reason,
        });
        return count;
      });
      invalidateAllowlist();
    }
    const counts = { exists: 0, covered: 0, limit: 0 };
    for (const status of result.values()) if (status !== 'new') counts[status]++;
    return reply.send({ added, rejected, ...counts });
  });
}
