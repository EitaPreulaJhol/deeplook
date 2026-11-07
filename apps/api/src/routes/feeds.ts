import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../env';
import { requireAdmin } from '../lib/auth';
import { feedData, type FeedEntry, type FeedIndicator } from '../lib/indicator-feed';
import {
  MISP_THREAT,
  MISP_TYPES,
  STIX_IDENTITY,
  STIX_INDICATOR_TYPES,
  STIX_PATTERNS,
  stixIndicatorId,
  uuidV5,
} from '../lib/ioc-export';

/**
 * Feed de indicadores (item 5.3), para outra ferramenta buscar sozinha: um servidor TAXII 2.1 so
 * de leitura (OpenCTI, Sentinel...) e um feed no formato do MISP, que o MISP puxa sem plugin. Os
 * dois servem o mesmo conjunto (lib/indicator-feed.ts) e usam os mesmos ids e uuids dos arquivos
 * .stix.json e .misp.json da ficha. Acesso: token de API de escopo FEED (Bearer, ou Basic com o
 * token como senha) ou o admin logado.
 */

const TAXII = 'application/taxii+json;version=2.1';
const STIX = 'application/stix+json;version=2.1';
const ROOT = '/api/taxii2/deeplook/';
export const COLLECTION_ID = uuidV5('collection:indicators');
const ORG = { name: 'DeepLook', uuid: uuidV5('org:deeplook') };
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

const COLLECTION = {
  id: COLLECTION_ID,
  title: 'Indicadores do DeepLook',
  description:
    'Indicadores de amostras maliciosas e suspeitas, sem os da lista de permitidos e sem os ' +
    'domínios da empresa.',
  can_read: true,
  can_write: false,
  media_types: [STIX],
};

/** Endereco publico: atras do Tunnel o nginx recebe http, entao o https vem do COOKIE_SECURE. */
function baseUrl(req: FastifyRequest): string {
  const proto = env.COOKIE_SECURE === 'true' ? 'https' : req.protocol;
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

function taxiiError(reply: FastifyReply, status: number, title: string, description?: string) {
  return reply
    .code(status)
    .type(TAXII)
    .send({ title, description, http_status: String(status) });
}

/** Cliente que pede outra versao do TAXII recebe 406, como a especificacao manda. */
function acceptsTaxii(req: FastifyRequest): boolean {
  const accept = String(req.headers.accept ?? '').toLowerCase();
  if (!accept.includes('application/taxii+json')) return true;
  return accept.split(',').some((part) => {
    const media = part.trim();
    return (
      media.startsWith('application/taxii+json') &&
      (!media.includes('version=') || media.includes('version=2.1'))
    );
  });
}

/** Admin (token FEED ou sessao) e versao aceita; em erro, ja respondeu. */
async function guard(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!(await requireAdmin(req, reply))) return false;
  if (!acceptsTaxii(req)) {
    taxiiError(reply, 406, 'Versão não suportada', `Este servidor só fala ${TAXII}.`);
    return false;
  }
  return true;
}

const iso = (d: Date) => d.toISOString();

function describeEntries(entries: { title: string }[]): string {
  const titles = entries.slice(0, 5).map((e) => e.title);
  const rest = entries.length > 5 ? ` e mais ${entries.length - 5}` : '';
  return `DeepLook: ${entries.length} amostra(s): ${titles.join('; ')}${rest}`;
}

function indicatorObject(i: FeedIndicator) {
  return {
    type: 'indicator',
    spec_version: '2.1',
    id: stixIndicatorId(i.kind, i.value),
    created: iso(i.firstSeen),
    modified: iso(i.modified),
    created_by_ref: STIX_IDENTITY.id,
    name: i.value,
    description: describeEntries(i.entries),
    indicator_types: STIX_INDICATOR_TYPES[i.verdict],
    pattern: STIX_PATTERNS[i.kind](i.value),
    pattern_type: 'stix',
    valid_from: iso(i.firstSeen),
  };
}

/** Os objetos da colecao, em ordem de date_added e id (a ordem da paginacao). */
async function collectionObjects() {
  const data = await feedData();
  const items: { object: Record<string, unknown>; dateAdded: string; version: string }[] = [
    {
      object: { ...STIX_IDENTITY },
      dateAdded: STIX_IDENTITY.created,
      version: STIX_IDENTITY.modified,
    },
    ...data.indicators.map((i) => ({
      object: indicatorObject(i),
      dateAdded: iso(i.modified),
      version: iso(i.modified),
    })),
  ];
  return items.sort(
    (a, b) =>
      a.dateAdded.localeCompare(b.dateAdded) ||
      String(a.object.id).localeCompare(String(b.object.id)),
  );
}

type Query = Record<string, string | undefined>;

/** Filtros da especificacao: added_after, match[id], match[type], match[version], limit, next. */
function page<T extends { object: Record<string, unknown>; dateAdded: string; version: string }>(
  items: T[],
  query: Query,
): { items: T[]; more: boolean; next?: string } | { error: string } {
  let list = items;
  if (query.added_after) {
    const after = Date.parse(query.added_after);
    if (Number.isNaN(after)) return { error: 'added_after não é uma data.' };
    list = list.filter((i) => Date.parse(i.dateAdded) > after);
  }
  const csv = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()) : null);
  const ids = csv(query['match[id]']);
  if (ids) list = list.filter((i) => ids.includes(String(i.object.id)));
  const types = csv(query['match[type]']);
  if (types) list = list.filter((i) => types.includes(String(i.object.type)));
  const versions = csv(query['match[version]']);
  if (versions && !versions.some((v) => ['last', 'first', 'all'].includes(v))) {
    list = list.filter((i) => versions.some((v) => Date.parse(v) === Date.parse(i.version)));
  }
  const specs = csv(query['match[spec_version]']);
  if (specs && !specs.includes('2.1')) list = [];
  if (query.next) {
    let cursor: [string, string];
    try {
      cursor = JSON.parse(Buffer.from(query.next, 'base64url').toString('utf8')) as [
        string,
        string,
      ];
    } catch {
      return { error: 'next inválido.' };
    }
    list = list.filter(
      (i) =>
        i.dateAdded > cursor[0] || (i.dateAdded === cursor[0] && String(i.object.id) > cursor[1]),
    );
  }
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const slice = list.slice(0, limit);
  const more = list.length > limit;
  const last = slice[slice.length - 1];
  return {
    items: slice,
    more,
    next:
      more && last
        ? Buffer.from(JSON.stringify([last.dateAdded, String(last.object.id)])).toString(
            'base64url',
          )
        : undefined,
  };
}

function dateHeaders(reply: FastifyReply, items: { dateAdded: string }[]) {
  if (!items.length) return;
  reply.header('X-TAXII-Date-Added-First', items[0].dateAdded);
  reply.header('X-TAXII-Date-Added-Last', items[items.length - 1].dateAdded);
}

// ------------------------------------------------------------------ MISP

const secs = (d: Date) => String(Math.floor(d.getTime() / 1000));
const ANALYSIS: Record<string, string> = { COMPLETED: '2', IN_REVIEW: '1', PENDING: '0' };
const eventUuid = (entryId: string) => uuidV5(`entry:${entryId}`);

function mispEvent(e: FeedEntry) {
  return {
    uuid: eventUuid(e.id),
    info: `DeepLook: ${e.title}`,
    date: iso(e.createdAt).slice(0, 10),
    threat_level_id: MISP_THREAT[e.verdict],
    analysis: ANALYSIS[e.status] ?? '0',
    distribution: '0',
    published: true,
    timestamp: secs(e.modified),
    publish_timestamp: secs(e.modified),
    Orgc: ORG,
    Tag: [{ name: `deeplook:verdict="${e.verdict.toLowerCase()}"` }],
    Attribute: e.iocs.map((ioc) => ({
      uuid: uuidV5(`${e.id}:${ioc.kind}:${ioc.value}`),
      ...MISP_TYPES[ioc.kind],
      value: ioc.value,
      to_ids: ioc.kind !== 'EMAIL',
      distribution: '5',
      timestamp: secs(e.modified),
      comment:
        ioc.source === 'REPORT' ? 'Relatório publicado no DeepLook' : 'Amostra enviada ao DeepLook',
    })),
  };
}

export async function feedRoutes(app: FastifyInstance) {
  // O Fastify reescreve o tipo como `application/taxii+json; version="2.1"; charset=utf-8`; a
  // especificacao define `application/taxii+json;version=2.1`, e cliente que compara o texto
  // recusaria. Aqui, depois da serializacao, vai o texto exato (so nas rotas deste plugin).
  app.addHook('onSend', async (_req, reply, payload) => {
    if (String(reply.getHeader('content-type') ?? '').startsWith('application/taxii+json')) {
      reply.header('content-type', TAXII);
    }
    return payload;
  });
  /** Registra o caminho com e sem a barra final: os clientes TAXII variam. */
  const get = (
    path: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) => {
    app.get(path, handler);
    app.get(path.replace(/\/$/, ''), handler);
  };

  get('/api/taxii2/', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    const root = `${baseUrl(req)}${ROOT}`;
    return reply.type(TAXII).send({
      title: 'DeepLook TAXII',
      description: 'Indicadores de amostras maliciosas e suspeitas analisadas no DeepLook.',
      default: root,
      api_roots: [root],
    });
  });

  get(ROOT, async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return reply.type(TAXII).send({
      title: 'DeepLook',
      description: 'Indicadores do DeepLook (só leitura).',
      versions: [TAXII],
      max_content_length: 0,
    });
  });

  get(`${ROOT}collections/`, async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return reply.type(TAXII).send({ collections: [COLLECTION] });
  });

  /** A colecao pedida existe? Em erro, ja respondeu. */
  const collection = (req: FastifyRequest, reply: FastifyReply) => {
    const { collectionId } = req.params as { collectionId: string };
    if (collectionId === COLLECTION_ID) return true;
    taxiiError(reply, 404, 'Coleção não encontrada');
    return false;
  };

  get(`${ROOT}collections/:collectionId/`, async (req, reply) => {
    if (!(await guard(req, reply)) || !collection(req, reply)) return;
    return reply.type(TAXII).send(COLLECTION);
  });

  get(`${ROOT}collections/:collectionId/objects/`, async (req, reply) => {
    if (!(await guard(req, reply)) || !collection(req, reply)) return;
    const result = page(await collectionObjects(), req.query as Query);
    if ('error' in result) return taxiiError(reply, 400, 'Filtro inválido', result.error);
    dateHeaders(reply, result.items);
    return reply.type(TAXII).send({
      more: result.more,
      ...(result.next ? { next: result.next } : {}),
      objects: result.items.map((i) => i.object),
    });
  });

  get(`${ROOT}collections/:collectionId/objects/:objectId/`, async (req, reply) => {
    if (!(await guard(req, reply)) || !collection(req, reply)) return;
    const { objectId } = req.params as { objectId: string };
    const found = (await collectionObjects()).filter((i) => i.object.id === objectId);
    if (!found.length) return taxiiError(reply, 404, 'Objeto não encontrado');
    dateHeaders(reply, found);
    return reply.type(TAXII).send({ more: false, objects: found.map((i) => i.object) });
  });

  get(`${ROOT}collections/:collectionId/objects/:objectId/versions/`, async (req, reply) => {
    if (!(await guard(req, reply)) || !collection(req, reply)) return;
    const { objectId } = req.params as { objectId: string };
    const found = (await collectionObjects()).filter((i) => i.object.id === objectId);
    if (!found.length) return taxiiError(reply, 404, 'Objeto não encontrado');
    dateHeaders(reply, found);
    return reply.type(TAXII).send({ more: false, versions: found.map((i) => i.version) });
  });

  get(`${ROOT}collections/:collectionId/manifest/`, async (req, reply) => {
    if (!(await guard(req, reply)) || !collection(req, reply)) return;
    const result = page(await collectionObjects(), req.query as Query);
    if ('error' in result) return taxiiError(reply, 400, 'Filtro inválido', result.error);
    dateHeaders(reply, result.items);
    return reply.type(TAXII).send({
      more: result.more,
      ...(result.next ? { next: result.next } : {}),
      objects: result.items.map((i) => ({
        id: i.object.id,
        date_added: i.dateAdded,
        version: i.version,
        media_type: STIX,
      })),
    });
  });

  // Feed MISP: no MISP, "Add Feed" > formato "MISP Feed", URL .../api/feeds/misp e o cabecalho
  // "Authorization: Bearer <token>". O MISP le o manifest.json e busca cada <uuid>.json.
  app.get('/api/feeds/misp/manifest.json', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { entries } = await feedData();
    const manifest: Record<string, object> = {};
    for (const e of entries) {
      const ev = mispEvent(e);
      manifest[ev.uuid] = {
        Orgc: ev.Orgc,
        Tag: ev.Tag,
        info: ev.info,
        date: ev.date,
        analysis: ev.analysis,
        threat_level_id: ev.threat_level_id,
        timestamp: ev.timestamp,
      };
    }
    return reply.type('application/json').send(manifest);
  });

  app.get('/api/feeds/misp/:file', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { file } = req.params as { file: string };
    const uuid = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/.exec(
      file,
    )?.[1];
    const entry = uuid && (await feedData()).entries.find((e) => eventUuid(e.id) === uuid);
    if (!entry) return reply.code(404).send({ error: 'Evento não encontrado no feed.' });
    return reply.type('application/json').send({ Event: mispEvent(entry) });
  });
}
