import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { requireAdmin, requireUser, visibleEntries } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { ownSamplesOnly, setOwnSamplesOnly } from '../lib/settings';
import { sendValidationError } from '../lib/validation';
import { setYaraPackEnabled, yaraPackList } from '../lib/yara-packs';

const SettingsSchema = z.object({ ownSamplesOnly: z.boolean() }).strict();

/** Configuracoes do sistema feitas na tela (item 140). */
export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/admin/settings', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    return reply.send({ ownSamplesOnly: await ownSamplesOnly() });
  });

  app.patch('/api/admin/settings', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const value = parsed.data.ownSamplesOnly;
    if ((await ownSamplesOnly()) !== value) {
      await setOwnSamplesOnly(value);
      await audit(prisma, req, {
        action: 'SETTING_CHANGED',
        actorId: user.id,
        targetLabel: 'Usuários comuns veem só as próprias amostras',
        detail: value ? 'ligada' : 'desligada',
      });
    }
    return reply.send({ ownSamplesOnly: value });
  });

  // Pacotes de regras YARA (itens 143 e 144): a lista esta em /api/yara/packs.
  app.patch('/api/admin/yara-packs/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const { enabled } = parsed.data;
    if (!(await setYaraPackEnabled(id, enabled))) {
      return reply.code(404).send({ error: 'Pacote não encontrado.' });
    }
    await audit(prisma, req, {
      action: 'SETTING_CHANGED',
      actorId: user.id,
      targetLabel: `Pacote de regras YARA ${id}`,
      detail: enabled ? 'ligado' : 'desligado',
    });
    return reply.send({ packs: await yaraPackList() });
  });

  // O que a tela da pessoa deve mostrar; quem garante a regra e a API.
  app.get('/api/me/sample-access', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return reply.send({ ownOnly: Boolean((await visibleEntries(user)).ownerId) });
  });
}
