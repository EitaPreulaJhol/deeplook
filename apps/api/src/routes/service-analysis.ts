import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ServiceKind } from '../generated/prisma/client';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeAlerts, localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { scrubForViewer } from '../lib/exfil-store';
import { prisma } from '../lib/prisma';
import { serviceAutoEligible } from '../lib/service-analysis';
import { enqueueService, serviceDef, serviceEnabled } from '../lib/services';
import { sendValidationError } from '../lib/validation';

/** Tipo na URL -> tipo no banco. */
const KINDS: Record<string, ServiceKind> = {
  emulation: 'EMULATION',
  android: 'ANDROID',
  config: 'CONFIG',
  dotnet: 'DOTNET',
  jar: 'JAR',
  jsdeob: 'JSDEOB',
  metadata: 'METADATA',
  pydec: 'PYDEC',
};

/** Opcoes do pedido: so a emulacao tem (shellcode e a arquitetura). */
const RequestBody = z
  .object({
    kind: z.enum(['pe', 'shellcode']).optional(),
    arch: z.enum(['x86', 'amd64']).optional(),
  })
  .strict();

const analysisSelect = {
  status: true,
  options: true,
  result: true,
  alerts: true,
  iocs: true,
  error: true,
  version: true,
  ms: true,
  attempts: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

async function entryOf(id: string) {
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: { type: true, fileSize: true, filePurgedAt: true, staticInfo: true },
  });
  if (!entry) return null;
  const typeId = (entry.staticInfo as { detectedType?: { id?: string } | null } | null)
    ?.detectedType?.id;
  return { ...entry, typeId };
}

/**
 * Emulacao (item 4), APK (item 6) e configuracao de familias (item 2) das novas analises: o
 * resultado e o pedido de analise de novo. Quem ve a amostra ve a analise; so analistas pedem.
 */
export async function serviceAnalysisRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/analyses/:kind', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id, kind } = req.params as { id: string; kind: string };
    const serviceKind = KINDS[kind];
    if (!serviceKind) return reply.code(404).send({ error: 'Análise desconhecida.' });
    const entry = await entryOf(id);
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const def = serviceDef(serviceKind)!;
    const analysis = await prisma.serviceAnalysis.findUnique({
      where: { entryId_kind: { entryId: id, kind: serviceKind } },
      select: analysisSelect,
    });
    const lang = requestLang(req);
    const file = entry.type === 'FILE' && !entry.filePurgedAt;
    return reply.send({
      enabled: serviceEnabled(serviceKind),
      // Vai sozinho para a fila no envio; o pedido manual vale para mais tipos (shellcode).
      auto: file && serviceAutoEligible(def, entry.typeId, entry.fileSize ?? null),
      manual: file && def.manualOk(entry.typeId, {}),
      maxMb: def.maxMb(),
      analysis: analysis && {
        ...analysis,
        // Credencial dos canais de exfiltracao so inteira para analistas (item 3).
        result: await scrubForViewer(id, isAnalyst(user), analysis.result),
        alerts: localizeAlerts(analysis.alerts as { level: string; text: string }[] | null, lang),
        error: localizeText(analysis.error, lang),
      },
    });
  });

  app.post('/api/entries/:id/analyses/:kind', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem esta análise.' });
    }
    const { id, kind } = req.params as { id: string; kind: string };
    const serviceKind = KINDS[kind];
    if (!serviceKind) return reply.code(404).send({ error: 'Análise desconhecida.' });
    if (!serviceEnabled(serviceKind)) {
      return reply.code(503).send({ error: 'Esta análise está desligada neste servidor.' });
    }
    const parsed = RequestBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Opções inválidas.');
    const options = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;
    if (Object.keys(options).length && serviceKind !== 'EMULATION') {
      return reply.code(400).send({ error: 'Esta análise não tem opções.' });
    }
    const entry = await entryOf(id);
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (entry.filePurgedAt) {
      return reply
        .code(400)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    const def = serviceDef(serviceKind)!;
    const size = entry.fileSize ?? 0;
    if (entry.type !== 'FILE' || !def.manualOk(entry.typeId, options)) {
      return reply.code(400).send({ error: 'Este tipo de arquivo não vale para esta análise.' });
    }
    if (size <= 0 || size > def.maxMb() * 1024 * 1024) {
      return reply.code(400).send({ error: `Só arquivos de até ${def.maxMb()} MB.` });
    }
    const current = await prisma.serviceAnalysis.findUnique({
      where: { entryId_kind: { entryId: id, kind: serviceKind } },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A análise já está na fila.' });
    }
    await enqueueService(serviceKind, id, options);
    return reply.code(202).send({ ok: true });
  });
}
