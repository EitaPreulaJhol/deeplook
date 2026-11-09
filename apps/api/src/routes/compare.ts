import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { findTechnique } from '../lib/attack';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import type { StaticInfo } from '../lib/static-analysis';
import { sendValidationError } from '../lib/validation';
import { entryIocs } from './iocs';

const Query = z.object({
  a: z.string().min(1).max(64),
  b: z.string().min(1).max(64),
});

/** Ate quantos itens de cada lista vao na resposta (strings podem ser muitas). */
const MAX_ITEMS = 200;

export interface SetDiff {
  common: string[];
  onlyA: string[];
  onlyB: string[];
}

/** O que e comum e o que e so de cada lado (ordem alfabetica, sem repetir). */
export function diffSets(a: Iterable<string>, b: Iterable<string>): SetDiff {
  const setA = new Set(a);
  const setB = new Set(b);
  const sorted = (values: string[]) => [...new Set(values)].sort().slice(0, MAX_ITEMS);
  return {
    common: sorted([...setA].filter((v) => setB.has(v))),
    onlyA: sorted([...setA].filter((v) => !setB.has(v))),
    onlyB: sorted([...setB].filter((v) => !setA.has(v))),
  };
}

/** Campos da amostra mostrados lado a lado (e o que alimenta as listas). */
async function profile(id: string) {
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      verdict: true,
      priority: true,
      createdAt: true,
      originalFilename: true,
      fileSize: true,
      mimeType: true,
      sha256: true,
      url: true,
      urlDomain: true,
      staticInfo: true,
      owner: { select: { id: true, displayName: true } },
      yara: { select: { status: true, matches: true } },
      reports: {
        where: { status: 'PUBLISHED' },
        select: { attackTechniques: true },
      },
    },
  });
  if (!entry) return null;
  const info = entry.staticInfo as unknown as StaticInfo | null;
  const iocs = (await entryIocs(id))?.iocs ?? [];
  const yaraHits =
    entry.yara?.status === 'MATCHED'
      ? (entry.yara.matches as { identifier: string }[]).map((m) => m.identifier)
      : [];
  const techniques = [...new Set(entry.reports.flatMap((r) => r.attackTechniques))];
  return {
    entry: {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      status: entry.status,
      verdict: entry.verdict,
      priority: entry.priority,
      createdAt: entry.createdAt,
      owner: entry.owner,
      originalFilename: entry.originalFilename,
      fileSize: entry.fileSize,
      mimeType: entry.mimeType,
      sha256: entry.sha256,
      url: entry.url,
      urlDomain: entry.urlDomain,
      detectedType: info?.detectedType?.label ?? null,
      entropy: info?.entropy ?? null,
      entropyLevel: info?.entropyLevel ?? null,
      stringsTotal: info?.strings.total ?? null,
      pe: info?.pe
        ? {
            machine: info.pe.machine,
            isDll: info.pe.isDll,
            subsystem: info.pe.subsystem,
            compiledAt: info.pe.compiledAt,
            packer: info.pe.packer,
            // Item 7.1 (null em analise antiga).
            imphash: info.pe.imphash ?? null,
            richHash: info.pe.rich?.hash ?? null,
            signer: info.pe.signature?.signer?.subject ?? null,
          }
        : null,
    },
    lists: {
      iocs: iocs.map((i) => `${i.kind}:${i.value}`),
      urls: info?.strings.urls ?? [],
      ips: info?.strings.ips ?? [],
      emails: info?.strings.emails ?? [],
      paths: info?.strings.paths ?? [],
      registry: info?.strings.registry ?? [],
      suspicious: info?.strings.suspicious ?? [],
      imports: info?.pe?.imports.map((i) => i.dll.toLowerCase()) ?? [],
      suspiciousImports: info?.pe?.suspiciousImports ?? [],
      sections: info?.pe?.sections.map((s) => s.name) ?? [],
      yara: yaraHits,
      attack: techniques.map((t) => `${t} ${findTechnique(t)?.name ?? ''}`.trim()),
    },
  };
}

/**
 * Comparar duas amostras (item 58): campos lado a lado e, para cada lista
 * (IOCs, strings, imports, secoes, YARA, ATT&CK), o que e comum e o que e so de
 * cada uma. Nada e executado; usa a analise estatica guardada no envio.
 */
export async function compareRoutes(app: FastifyInstance) {
  app.get('/api/entries/compare', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas comparam amostras.' });
    }
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { a, b } = parsed.data;
    if (a === b) return reply.code(400).send({ error: 'Escolha duas amostras diferentes.' });
    const [pa, pb] = await Promise.all([profile(a), profile(b)]);
    if (!pa || !pb) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const keys = Object.keys(pa.lists) as (keyof typeof pa.lists)[];
    const lists = Object.fromEntries(keys.map((k) => [k, diffSets(pa.lists[k], pb.lists[k])]));
    return reply.send({
      a: pa.entry,
      b: pb.entry,
      sameContent: Boolean(pa.entry.sha256 && pa.entry.sha256 === pb.entry.sha256),
      lists,
    });
  });
}
