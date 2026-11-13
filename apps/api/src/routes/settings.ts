import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { requireAdmin, requireUser, visibleEntries } from '../lib/auth';
import { localizeData } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import { ownSamplesOnly, setOwnSamplesOnly } from '../lib/settings';
import { sendValidationError } from '../lib/validation';
import { setYaraPackEnabled, yaraPackList, yaraPacks } from '../lib/yara-packs';
import {
  approveRelease,
  checkYaraPack,
  dismissRelease,
  rollbackRelease,
  setAutoUpdate,
  yaraUpdateStatus,
} from '../lib/yara-update';

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

  // Atualizacao dos pacotes (item 150).
  app.get('/api/admin/yara-packs/updates', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    return reply.send(localizeData(await yaraUpdateStatus(), requestLang(req)));
  });

  app.patch('/api/admin/yara-packs/updates', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = z.object({ autoUpdate: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    await setAutoUpdate(parsed.data.autoUpdate);
    await audit(prisma, req, {
      action: 'SETTING_CHANGED',
      actorId: user.id,
      targetLabel: 'Atualização automática dos pacotes YARA',
      detail: parsed.data.autoUpdate ? 'ligada' : 'desligada',
    });
    return reply.send(localizeData(await yaraUpdateStatus(), requestLang(req)));
  });

  app.post('/api/admin/yara-packs/:id/check', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = z
      .object({ apply: z.boolean().default(false) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    if (!yaraPacks().some((p) => p.id === id)) {
      return reply.code(404).send({ error: 'Pacote não encontrado.' });
    }
    try {
      // Motivos de retencao no idioma de quem pede (plano pos-revisao, item 1.4).
      return reply.send(
        localizeData(
          await checkYaraPack(id, { apply: parsed.data.apply, actorId: user.id }),
          requestLang(req),
        ),
      );
    } catch (err) {
      return reply
        .code(502)
        .send({ error: `Não foi possível verificar: ${(err as Error).message}` });
    }
  });

  const releaseAction = (
    action: 'approve' | 'dismiss' | 'rollback',
    run: (id: string, actorId: string) => Promise<unknown>,
  ) =>
    app.post(`/api/admin/yara-releases/:id/${action}`, async (req, reply) => {
      const user = await requireAdmin(req, reply);
      if (!user) return;
      const { id } = req.params as { id: string };
      try {
        const done = await run(id, user.id);
        if (!done) {
          return reply.code(409).send({ error: 'Esta atualização não permite mais essa ação.' });
        }
        return reply.send(localizeData(await yaraUpdateStatus(), requestLang(req)));
      } catch (err) {
        return reply
          .code(502)
          .send({ error: `Não foi possível concluir: ${(err as Error).message}` });
      }
    });
  releaseAction('approve', approveRelease);
  releaseAction('dismiss', dismissRelease);
  releaseAction('rollback', rollbackRelease);

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
