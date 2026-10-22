import type { IocKind, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../lib/auth';
import type { ExportIoc } from '../lib/ioc-export';
import { iocsCsv, iocsMisp, iocsStix } from '../lib/ioc-export';
import { extractIocs } from '../lib/iocs';
import { prisma } from '../lib/prisma';

/** Maximo de amostras na ficha do indicador. */
const SIGHTINGS_LIMIT = 200;

const KINDS: Record<string, IocKind> = {
  ipv4: 'IPV4',
  domain: 'DOMAIN',
  email: 'EMAIL',
  md5: 'MD5',
  sha1: 'SHA1',
  sha256: 'SHA256',
};

const KIND_ORDER: ExportIoc['kind'][] = ['SHA256', 'SHA1', 'MD5', 'URL', 'DOMAIN', 'IPV4', 'EMAIL'];

const listInclude = {
  owner: { select: { id: true, displayName: true, email: true } },
  assignee: { select: { id: true, displayName: true } },
  tags: true,
  _count: { select: { reports: true } },
} satisfies Prisma.EntryInclude;

type ListEntry = Prisma.EntryGetPayload<{ include: typeof listInclude }>;

export type Sighting =
  | { kind: 'REPORT'; reportId: string; analyst: string; createdAt: Date }
  | { kind: 'FILE' }
  | { kind: 'URL_HOST' };

/**
 * Indicadores da amostra: os dos relatorios publicados (indice ReportIoc) e os
 * da propria amostra (SHA-256 do arquivo, URL e dominio).
 */
async function entryIocs(entryId: string) {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      title: true,
      status: true,
      verdict: true,
      createdAt: true,
      sha256: true,
      url: true,
      urlDomain: true,
    },
  });
  if (!entry) return null;

  const rows = await prisma.reportIoc.findMany({
    where: { entryId },
    select: { kind: true, value: true, reportId: true },
  });
  const found = new Map<string, ExportIoc & { reportIds: string[] }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.value}`;
    const item = found.get(key) ?? {
      kind: row.kind,
      value: row.value,
      source: 'REPORT',
      reportIds: [],
    };
    item.reportIds.push(row.reportId);
    found.set(key, item);
  }
  const own = (kind: ExportIoc['kind'], value: string | null) => {
    if (value && !found.has(`${kind}:${value}`)) {
      found.set(`${kind}:${value}`, { kind, value, source: 'SAMPLE', reportIds: [] });
    }
  };
  own('SHA256', entry.sha256?.toLowerCase() ?? null);
  own('URL', entry.url);
  own('DOMAIN', entry.urlDomain?.toLowerCase() ?? null);

  const iocs = [...found.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.value.localeCompare(b.value),
  );
  return { entry, iocs };
}

/**
 * Indicadores (IOCs): busca pelo "Ir para:", ficha do indicador (onde ele
 * aparece) e exportacao dos IOCs de uma amostra em CSV, STIX 2.1 ou MISP.
 */
export async function iocRoutes(app: FastifyInstance) {
  // Texto livre -> indicador reconhecido (aceita hxxp, [.], URL inteira...).
  app.get('/api/iocs/lookup', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { q = '' } = req.query as { q?: string };
    const [ioc] = extractIocs(q.slice(0, 2000));
    if (!ioc) return reply.code(404).send({ error: 'Nao e um indicador reconhecido.' });
    return reply.send({ ioc });
  });

  // Ficha do indicador: amostras em que ele aparece (relatorio, arquivo, dominio).
  app.get('/api/iocs/:kind/:value', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const params = req.params as { kind: string; value: string };
    const kind = KINDS[params.kind.toLowerCase()];
    const value = params.value.trim().toLowerCase();
    // So indicadores que a extracao reconhece (evita fichas para lixo/IP privado).
    const valid = kind && extractIocs(value).some((i) => i.kind === kind && i.value === value);
    if (!valid) return reply.code(400).send({ error: 'Indicador invalido.' });

    const [reportHits, fileHits, hostHits] = await Promise.all([
      prisma.reportIoc.findMany({
        where: { kind, value, entry: { deletedAt: null } },
        select: {
          entryId: true,
          report: {
            select: { id: true, createdAt: true, analyst: { select: { displayName: true } } },
          },
        },
        take: 1000,
      }),
      kind === 'SHA256'
        ? prisma.entry.findMany({
            where: { sha256: value },
            select: { id: true },
            take: SIGHTINGS_LIMIT,
          })
        : [],
      kind === 'DOMAIN'
        ? prisma.entry.findMany({
            where: { urlDomain: value },
            select: { id: true },
            take: SIGHTINGS_LIMIT,
          })
        : [],
    ]);

    const sightings = new Map<string, Sighting[]>();
    const note = (entryId: string, sighting: Sighting) =>
      sightings.set(entryId, [...(sightings.get(entryId) ?? []), sighting]);
    for (const hit of fileHits) note(hit.id, { kind: 'FILE' });
    for (const hit of hostHits) note(hit.id, { kind: 'URL_HOST' });
    for (const hit of reportHits) {
      note(hit.entryId, {
        kind: 'REPORT',
        reportId: hit.report.id,
        analyst: hit.report.analyst.displayName,
        createdAt: hit.report.createdAt,
      });
    }

    const entries: ListEntry[] = sightings.size
      ? await prisma.entry.findMany({
          where: { id: { in: [...sightings.keys()] } },
          include: listInclude,
          orderBy: { createdAt: 'desc' },
          take: SIGHTINGS_LIMIT,
        })
      : [];

    // Primeira/ultima aparicao: envio da amostra ou data do relatorio.
    const dates = entries.flatMap((e) => [
      ...(sightings.get(e.id) ?? []).map((s) =>
        s.kind === 'REPORT' ? s.createdAt.getTime() : e.createdAt.getTime(),
      ),
    ]);
    return reply.send({
      ioc: { kind, value },
      items: entries.map((entry) => ({ entry, sightings: sightings.get(entry.id) ?? [] })),
      total: sightings.size,
      firstSeen: dates.length ? new Date(Math.min(...dates)) : null,
      lastSeen: dates.length ? new Date(Math.max(...dates)) : null,
    });
  });

  // IOCs da amostra (aba Relatorios: "Indicadores reconhecidos").
  app.get('/api/entries/:id/iocs', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const result = await entryIocs((req.params as { id: string }).id);
    if (!result) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    return reply.send({ iocs: result.iocs });
  });

  // Exportacao dos IOCs da amostra: ?format=csv | stix | misp.
  const ExportQuery = z.object({ format: z.enum(['csv', 'stix', 'misp']) });
  app.get('/api/entries/:id/iocs/export', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ExportQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Formato invalido.' });
    const result = await entryIocs((req.params as { id: string }).id);
    if (!result) return reply.code(404).send({ error: 'Amostra nao encontrada.' });

    const { entry, iocs } = result;
    const base = `deeplook-${entry.id}-iocs`;
    const items = iocs.map(({ kind, value, source }) => ({ kind, value, source }));
    switch (parsed.data.format) {
      case 'csv':
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${base}.csv"`)
          .send(iocsCsv(entry, items));
      case 'stix':
        return reply
          .header('Content-Type', 'application/stix+json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${base}.stix.json"`)
          .send(JSON.stringify(iocsStix(entry, items), null, 2));
      case 'misp':
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${base}.misp.json"`)
          .send(JSON.stringify(iocsMisp(entry, items), null, 2));
    }
  });
}
