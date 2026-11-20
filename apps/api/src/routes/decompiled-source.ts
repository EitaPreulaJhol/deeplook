import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { dotnetSource, dotnetSources } from '../lib/dotnet';
import { jarSource, jarSources } from '../lib/jar';
import { prisma } from '../lib/prisma';
import { pydecSource, pydecSources } from '../lib/pydec';
import { ZipWriter } from '../lib/zip-writer';

/**
 * O fonte descompilado (.NET, plans/caca-e-formatos item 3; e Java): uma classe por vez, para a
 * tela, e o projeto inteiro em ZIP. Como o pseudo-C do Ghidra: quem enviou e os analistas.
 */
interface SourceRoutes {
  /** Parte da URL: /api/entries/:id/<slug>/source. */
  slug: 'dotnet' | 'jar' | 'pydec';
  source: (entryId: string, path: string) => Promise<string | null>;
  sources: (entryId: string) => Promise<Record<string, string> | null>;
  /** O que a auditoria registra no download. */
  detail: string;
}

async function sourceRoutes(app: FastifyInstance, cfg: SourceRoutes) {
  const entryFor = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { id: true, ownerId: true, title: true },
    });
    if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
      reply
        .code(403)
        .send({ error: 'Somente quem enviou e os analistas veem o código descompilado.' });
      return null;
    }
    if (!entry) {
      reply.code(404).send({ error: 'Amostra não encontrada.' });
      return null;
    }
    return { user, entry };
  };

  app.get(`/api/entries/:id/${cfg.slug}/source`, async (req, reply) => {
    const found = await entryFor(req, reply);
    if (!found) return;
    const path = String((req.query as { path?: string }).path ?? '');
    if (!path || path.length > 500) {
      return reply.code(400).send({ error: 'Informe qual arquivo do projeto (parâmetro path).' });
    }
    const source = await cfg.source(found.entry.id, path);
    if (source === null)
      return reply.code(404).send({ error: 'Arquivo não encontrado no projeto.' });
    return reply.send({ path, source });
  });

  app.get(`/api/entries/:id/${cfg.slug}/download`, async (req, reply) => {
    const found = await entryFor(req, reply);
    if (!found) return;
    const sources = await cfg.sources(found.entry.id);
    if (!sources)
      return reply.code(404).send({ error: 'Não há código descompilado desta amostra.' });
    const dir = await mkdtemp(join(tmpdir(), `${cfg.slug}-`));
    const file = join(dir, 'projeto.zip');
    try {
      const zip = await ZipWriter.create(file);
      for (const [path, text] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
        const data = Buffer.from(text, 'utf8');
        await zip.add(path, data.length, data);
      }
      await zip.finish();
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: found.user.id,
      targetUserId: found.entry.ownerId,
      targetLabel: found.entry.title,
      detail: cfg.detail,
    });
    const stream = createReadStream(file);
    stream.on('close', () => void rm(dir, { recursive: true, force: true }));
    return reply
      .header('Content-Type', 'application/zip')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `attachment; filename="deeplook-${found.entry.id}-${cfg.slug}.zip"`,
      )
      .send(stream);
  });
}

export const dotnetRoutes = (app: FastifyInstance) =>
  sourceRoutes(app, {
    slug: 'dotnet',
    source: dotnetSource,
    sources: dotnetSources,
    detail: 'código .NET descompilado (.zip)',
  });

export const jarRoutes = (app: FastifyInstance) =>
  sourceRoutes(app, {
    slug: 'jar',
    source: jarSource,
    sources: jarSources,
    detail: 'código Java descompilado (.zip)',
  });

export const pydecRoutes = (app: FastifyInstance) =>
  sourceRoutes(app, {
    slug: 'pydec',
    source: pydecSource,
    sources: pydecSources,
    detail: 'código Python descompilado (.zip)',
  });
