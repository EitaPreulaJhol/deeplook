import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { isAnalyst, requireAdmin, requireUser } from '../lib/auth';
import { refreshDocumentIconAlerts } from '../lib/document-icons';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const AddSchema = z
  .object({ entryId: z.string().min(1).max(40), label: z.string().trim().min(2).max(60) })
  .strict();

/** Icones de documento (plans/analise-estatica-ampliada, item 2): os analistas veem, o admin muda. */
export async function documentIconRoutes(app: FastifyInstance) {
  app.get('/api/document-icons', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas veem os ícones de documento.' });
    }
    const icons = await prisma.documentIcon.findMany({ orderBy: { createdAt: 'desc' } });
    return reply.send({ icons });
  });

  app.post('/api/document-icons', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const entry = await prisma.entry.findUnique({
      where: { id: parsed.data.entryId },
      select: { staticInfo: true },
    });
    const hash = (entry?.staticInfo as { pe?: { icon?: { hash?: string } | null } | null } | null)
      ?.pe?.icon?.hash;
    if (!hash) return reply.code(400).send({ error: 'Esta amostra não tem ícone.' });
    await prisma.documentIcon.upsert({
      where: { hash },
      create: { hash, label: parsed.data.label, createdById: user.id },
      update: { label: parsed.data.label },
    });
    await audit(prisma, req, {
      action: 'SETTING_CHANGED',
      actorId: user.id,
      targetLabel: 'ícones de documento',
      detail: `adicionado: ${parsed.data.label} (${hash})`,
    });
    const changed = await refreshDocumentIconAlerts();
    return reply.code(201).send({ hash, changed });
  });

  app.delete('/api/document-icons/:hash', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { hash } = req.params as { hash: string };
    const icon = await prisma.documentIcon.findUnique({ where: { hash } });
    if (!icon) return reply.code(404).send({ error: 'Ícone não encontrado.' });
    await prisma.documentIcon.delete({ where: { hash } });
    await audit(prisma, req, {
      action: 'SETTING_CHANGED',
      actorId: user.id,
      targetLabel: 'ícones de documento',
      detail: `removido: ${icon.label} (${hash})`,
    });
    const changed = await refreshDocumentIconAlerts();
    return reply.send({ ok: true, changed });
  });
}
