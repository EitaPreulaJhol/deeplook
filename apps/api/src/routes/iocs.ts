import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { IocKind, Prisma } from '../generated/prisma/client';
import { allowedBy, loadAllowlist } from '../lib/allowlist';
import {
  isAnalyst,
  ownerForViewer,
  type PublicUser,
  requireUser,
  visibleEntries,
} from '../lib/auth';
import type { CaseIoc, ExportIoc } from '../lib/ioc-export';
import { iocsCsv, iocsMisp, iocsStix } from '../lib/ioc-export';
import { urlKey } from '../lib/ioc-normalize';
import { linkHostIndicator, linkIndicator } from '../lib/ioc-watch';
import { extractIocs, refang, rememberUrls } from '../lib/iocs';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

/** Maximo de amostras na ficha do indicador. */
const SIGHTINGS_LIMIT = 200;

const KINDS: Record<string, IocKind> = {
  ipv4: 'IPV4',
  ipv6: 'IPV6',
  url: 'URL',
  domain: 'DOMAIN',
  email: 'EMAIL',
  md5: 'MD5',
  sha1: 'SHA1',
  sha256: 'SHA256',
};

const KIND_ORDER: ExportIoc['kind'][] = [
  'SHA256',
  'SHA1',
  'MD5',
  'URL',
  'DOMAIN',
  'IPV4',
  'IPV6',
  'EMAIL',
];

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
  | { kind: 'URL_HOST' }
  | { kind: 'URL_SAMPLE' };

/** "Ir para:" (item 166): o texto colado, no corpo. */
const ResolveBody = z.object({ text: z.string().min(1).max(4000) });

/** Exportacao dos IOCs da amostra: ?format=csv | stix | misp. */
export const ExportQuery = z.object({ format: z.enum(['csv', 'stix', 'misp']) });

/**
 * Indicadores da amostra: os dos relatorios publicados (indice ReportIoc) e os
 * da propria amostra (SHA-256 do arquivo, URL e dominio).
 */
export async function entryIocs(entryId: string) {
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
  const own = (ioc: { kind: ExportIoc['kind']; value: string } | null) => {
    if (ioc && !found.has(`${ioc.kind}:${ioc.value}`)) {
      found.set(`${ioc.kind}:${ioc.value}`, { ...ioc, source: 'SAMPLE', reportIds: [] });
    }
  };
  own(entry.sha256 ? { kind: 'SHA256', value: entry.sha256.toLowerCase() } : null);
  // Link normalizado e o host como IP ou dominio (item 165), como no indice dos relatorios.
  own(linkIndicator(entry.url));
  own(linkHostIndicator(entry.urlDomain));

  const iocs = [...found.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.value.localeCompare(b.value),
  );
  return { entry, iocs };
}

/**
 * Indicadores de varias amostras (caso, item 74), sem repetir: cada um com as
 * amostras onde aparece. "Relatorio publicado" vence "propria amostra".
 */
export async function entriesIocs(entryIds: string[]): Promise<CaseIoc[]> {
  if (!entryIds.length) return [];
  const [entries, rows] = await Promise.all([
    prisma.entry.findMany({
      where: { id: { in: entryIds } },
      select: { id: true, title: true, verdict: true, sha256: true, url: true, urlDomain: true },
    }),
    prisma.reportIoc.findMany({
      where: { entryId: { in: entryIds } },
      select: { kind: true, value: true, entryId: true },
    }),
  ]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const found = new Map<string, CaseIoc>();
  const add = (
    kind: ExportIoc['kind'] | undefined,
    value: string | null | undefined,
    source: ExportIoc['source'],
    entryId: string,
  ) => {
    const entry = byId.get(entryId);
    if (!kind || !value || !entry) return;
    const key = `${kind}:${value}`;
    const item = found.get(key) ?? { kind, value, source, entries: [] };
    if (source === 'REPORT') item.source = 'REPORT';
    if (!item.entries.some((e) => e.id === entryId)) {
      item.entries.push({ id: entry.id, title: entry.title, verdict: entry.verdict });
    }
    found.set(key, item);
  };
  for (const row of rows) add(row.kind, row.value, 'REPORT', row.entryId);
  for (const e of entries) {
    add('SHA256', e.sha256?.toLowerCase() ?? null, 'SAMPLE', e.id);
    const link = linkIndicator(e.url);
    const host = linkHostIndicator(e.urlDomain);
    add(link?.kind, link?.value, 'SAMPLE', e.id);
    add(host?.kind, host?.value, 'SAMPLE', e.id);
  }
  return [...found.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.value.localeCompare(b.value),
  );
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
    if (!ioc) return reply.code(404).send({ error: 'Não é um indicador reconhecido.' });
    return reply.send({ ioc });
  });

  // "Ir para:" da tela (item 166): o texto vai no corpo, porque um link colado pode levar o
  // token da vitima. Um link sozinho vira o indicador de URL, guardado pela chave.
  app.post('/api/iocs/resolve', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ResolveBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const text = parsed.data.text.trim();
    const iocs = extractIocs(text);
    const single = !/\s/.test(refang(text));
    const ioc = (single && iocs.find((i) => i.kind === 'URL')) || iocs[0];
    if (!ioc) return reply.code(404).send({ error: 'Não é um indicador reconhecido.' });
    if (ioc.kind === 'URL') {
      await rememberUrls(prisma, [ioc]);
      // Quem digitou a URL abre a ficha dela mesmo com a restricao (ver urlVisible).
      await prisma.iocUrlLookup.upsert({
        where: { userId_key: { userId: user.id, key: urlKey(ioc.value) } },
        create: { userId: user.id, key: urlKey(ioc.value) },
        update: {},
      });
    }
    return reply.send({ ioc });
  });

  /**
   * Com "so as proprias amostras" (item 140), a tabela IocUrl e de todos: responder pela
   * chave confirmaria que a URL apareceu na amostra de outra pessoa (e devolveria o valor).
   * O usuario comum so abre a URL que esta em algo dele, que ele segue ou que digitou.
   */
  const urlVisible = async (user: PublicUser, key: string, value: string) => {
    const { ownerId } = await visibleEntries(user);
    if (!ownerId) return true;
    const checks = await Promise.all([
      prisma.iocUrlLookup.count({ where: { userId: user.id, key } }),
      prisma.iocWatch.count({ where: { userId: user.id, kind: 'URL', value } }),
      prisma.entry.count({ where: { ownerId, urlKey: key } }),
      prisma.reportIoc.count({ where: { kind: 'URL', value, entry: { ownerId } } }),
      prisma.entry.count({
        where: {
          ownerId,
          staticInfo: { path: ['iocCandidates'], array_contains: [{ kind: 'URL', value }] },
        },
      }),
    ]);
    return checks.some(Boolean);
  };

  /**
   * Indicador do endereco (mesma validacao da ficha). A URL vem pela chave (item 166),
   * e o valor sai da tabela IocUrl: 'missing' quando a chave nao e conhecida (ou, com a
   * restricao, nao e de quem pergunta: a mesma resposta).
   */
  const parseIoc = async (
    params: { kind: string; value: string },
    user: PublicUser,
  ): Promise<{ kind: IocKind; value: string } | null | 'missing'> => {
    const kind = KINDS[params.kind.toLowerCase()];
    if (kind === 'URL') {
      const key = params.value.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(key)) return null;
      const known = await prisma.iocUrl.findUnique({ where: { key } });
      if (!known || !(await urlVisible(user, key, known.value))) return 'missing';
      return { kind, value: known.value };
    }
    const value = params.value.trim().toLowerCase();
    const valid = kind && extractIocs(value).some((i) => i.kind === kind && i.value === value);
    return valid ? { kind, value } : null;
  };
  const MISSING = 'Indicador não encontrado.';

  // Alertas de IOC (item 60): seguir / deixar de seguir um indicador.
  app.post('/api/iocs/:kind/:value/watch', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ioc = await parseIoc(req.params as { kind: string; value: string }, user);
    if (!ioc) return reply.code(400).send({ error: 'Indicador inválido.' });
    if (ioc === 'missing') return reply.code(404).send({ error: MISSING });
    const count = await prisma.iocWatch.count({ where: { userId: user.id } });
    if (count >= 200) {
      return reply
        .code(409)
        .send({ error: 'Limite de 200 indicadores seguidos. Deixe de seguir algum.' });
    }
    await prisma.iocWatch.upsert({
      where: { userId_kind_value: { userId: user.id, ...ioc } },
      create: { userId: user.id, ...ioc },
      update: {},
    });
    return reply.send({ watching: true });
  });

  app.delete('/api/iocs/:kind/:value/watch', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ioc = await parseIoc(req.params as { kind: string; value: string }, user);
    if (!ioc) return reply.code(400).send({ error: 'Indicador inválido.' });
    if (ioc === 'missing') return reply.code(404).send({ error: MISSING });
    await prisma.iocWatch.deleteMany({ where: { userId: user.id, ...ioc } });
    return reply.send({ watching: false });
  });

  app.get('/api/me/watches', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const watches = await prisma.iocWatch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, value: true, createdAt: true },
    });
    return reply.send({ watches });
  });

  app.get('/api/iocs/:kind/:value', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    // So indicadores que a extracao reconhece (evita fichas para lixo/IP privado).
    const ioc = await parseIoc(req.params as { kind: string; value: string }, user);
    if (!ioc) return reply.code(400).send({ error: 'Indicador inválido.' });
    if (ioc === 'missing') return reply.code(404).send({ error: MISSING });
    const { kind, value } = ioc;

    const visible = await visibleEntries(user);
    const [reportHits, fileHits, hostHits, linkHits] = await Promise.all([
      prisma.reportIoc.findMany({
        where: { kind, value, entry: { deletedAt: null, ...visible } },
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
            where: { sha256: value, ...visible },
            select: { id: true },
            take: SIGHTINGS_LIMIT,
          })
        : [],
      // Links hospedados no indicador: dominio, ou IP (item 165; IPv6 fica entre colchetes).
      kind === 'DOMAIN' || kind === 'IPV4' || kind === 'IPV6'
        ? prisma.entry.findMany({
            where: { urlDomain: kind === 'IPV6' ? `[${value}]` : value, ...visible },
            select: { id: true },
            take: SIGHTINGS_LIMIT,
          })
        : [],
      // O proprio link da amostra (item 166), pela chave da URL normalizada.
      kind === 'URL'
        ? prisma.entry.findMany({
            where: { urlKey: (req.params as { value: string }).value.toLowerCase(), ...visible },
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
    for (const hit of linkHits) note(hit.id, { kind: 'URL_SAMPLE' });
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
    const [watching, list] = await Promise.all([
      prisma.iocWatch.findUnique({
        where: { userId_kind_value: { userId: user.id, kind, value } },
        select: { id: true },
      }),
      loadAllowlist(),
    ]);
    // Lista de permissoes (item 69): qual item cobre o indicador e o motivo. So para
    // analistas, como a propria lista (item 163).
    const allowedKey = isAnalyst(user) ? allowedBy(list, kind, value) : null;
    return reply.send({
      watching: Boolean(watching),
      allowed: allowedKey
        ? {
            by: allowedKey.slice(allowedKey.indexOf(':') + 1),
            reason: list.reasons.get(allowedKey) ?? '',
          }
        : null,
      ioc: { kind, value },
      items: entries.map((entry) => ({
        entry: ownerForViewer(entry, user),
        sightings: sightings.get(entry.id) ?? [],
      })),
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
    if (!result) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    return reply.send({ iocs: result.iocs });
  });

  app.get('/api/entries/:id/iocs/export', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ExportQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Formato inválido.' });
    const result = await entryIocs((req.params as { id: string }).id);
    if (!result) return reply.code(404).send({ error: 'Amostra não encontrada.' });

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
