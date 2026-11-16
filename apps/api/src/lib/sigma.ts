import { isIP } from 'node:net';

import { parse } from 'yaml';

/**
 * Avaliador de regras Sigma sobre os eventos do Sysmon do sandbox (plans/novas-analises, item 1).
 * Puro: recebe o YAML de uma regra e devolve uma funcao que diz se um evento casa. As regras
 * vendorizadas (apps/api/sigma, ver sigma-rules.ts) sao compiladas uma vez na subida.
 *
 * Suportado: os modificadores contains, startswith, endswith, all, re (com i, m e s), base64,
 * base64offset, wide/utf16le, windash, cidr, exists, gt, gte, lt, lte, cased e fieldref, o valor
 * null, listas de valores e de mapas, e a condicao com and, or, not, parenteses, `1 of x*`,
 * `all of x*`, `1 of them` e `all of them`. Fora: keywords (texto solto), agregacoes (`| count`)
 * e correlacoes. Regra com algo fora disso nao compila (SigmaUnsupported, com o motivo).
 */

export class SigmaUnsupported extends Error {}

/** Os campos de um evento do Sysmon (EventData), mais o EventID. */
export type SigmaEvent = { eventId: number; data: Record<string, string | null | undefined> };
type Matcher = (e: SigmaEvent) => boolean;

export type SigmaLevel = 'informational' | 'low' | 'medium' | 'high' | 'critical';
const LEVELS: SigmaLevel[] = ['informational', 'low', 'medium', 'high', 'critical'];

export interface SigmaRule {
  id: string;
  title: string;
  level: SigmaLevel;
  status: string | null;
  description: string | null;
  author: string | null;
  /** Tecnicas ATT&CK das tags (attack.t1059.001 -> T1059.001). */
  techniques: string[];
  references: string[];
  falsepositives: string[];
  /** Eventos do Sysmon a que a regra se aplica (pela logsource). */
  eventIds: number[];
  /** Caminho da regra no repositorio de origem (link na tela). */
  path: string;
  match: Matcher;
}

/**
 * Categoria da logsource -> eventos do Sysmon (o mesmo mapeamento do pipeline sysmon do pySigma).
 * Algumas categorias tambem pedem o tipo do evento de registro (EventType).
 */
const CATEGORIES: Record<string, { ids: number[]; eventType?: string[] }> = {
  process_creation: { ids: [1] },
  file_change: { ids: [2] },
  network_connection: { ids: [3] },
  sysmon_status: { ids: [4, 16] },
  process_termination: { ids: [5] },
  driver_load: { ids: [6] },
  image_load: { ids: [7] },
  create_remote_thread: { ids: [8] },
  raw_access_thread: { ids: [9] },
  process_access: { ids: [10] },
  file_event: { ids: [11] },
  registry_add: { ids: [12], eventType: ['CreateKey'] },
  registry_delete: { ids: [12], eventType: ['DeleteKey', 'DeleteValue'] },
  registry_set: { ids: [13] },
  registry_rename: { ids: [14] },
  registry_event: { ids: [12, 13, 14] },
  create_stream_hash: { ids: [15] },
  pipe_created: { ids: [17, 18] },
  wmi_event: { ids: [19, 20, 21] },
  dns_query: { ids: [22] },
  file_delete: { ids: [23, 26] },
  clipboard_capture: { ids: [24] },
  process_tampering: { ids: [25] },
  file_block: { ids: [27, 28] },
  sysmon_error: { ids: [255] },
};

/** Os eventos que a logsource cobre, ou o motivo de ela ficar de fora. */
export function sigmaEventIds(logsource: Record<string, unknown> | undefined): {
  ids: number[];
  eventType?: string[];
} {
  const product = logsource?.product;
  const category = logsource?.category;
  const service = logsource?.service;
  if (product !== 'windows') throw new SigmaUnsupported('produto não é windows');
  if (typeof category === 'string') {
    const found = CATEGORIES[category];
    if (!found) throw new SigmaUnsupported(`categoria ${category} fora do Sysmon`);
    return found;
  }
  // service: sysmon: a regra escolhe o EventID na propria deteccao.
  if (service === 'sysmon') return { ids: [] };
  throw new SigmaUnsupported(`serviço ${String(service)} fora do Sysmon`);
}

// ------------------------------------------------------------------ valores

/** Texto Sigma com curingas (* e ?, com \ de escape) -> trecho de regex. */
function wildcardSource(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length && '*?\\'.includes(value[i + 1])) {
      out += escapeRe(value[i + 1]);
      i++;
    } else if (ch === '*') out += '[\\s\\S]*';
    else if (ch === '?') out += '[\\s\\S]';
    else out += escapeRe(ch);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Variantes do base64offset (as tres posicoes do texto dentro do Base64), como o pySigma. */
function base64Offsets(bytes: Buffer): string[] {
  const start = [0, 2, 3];
  const end = [undefined, -3, -2];
  return [0, 1, 2].map((i) =>
    Buffer.concat([Buffer.alloc(i, 0x20), bytes])
      .toString('base64')
      .slice(start[i], end[(bytes.length + i) % 3]),
  );
}

/** windash: o traco no inicio de um parametro tambem vale como /, – (en), — (em) e ― (barra). */
const WINDASH = '[-/\\u2013\\u2014\\u2015]';

const MODIFIERS = new Set([
  'contains',
  'startswith',
  'endswith',
  'all',
  're',
  'i',
  'm',
  's',
  'base64',
  'base64offset',
  'wide',
  'utf16le',
  'windash',
  'cidr',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
  'cased',
  'fieldref',
]);

/** IPv4 ou IPv6 como numero. */
function ipValue(ip: string): { v6: boolean; n: bigint } | null {
  const kind = isIP(ip);
  if (kind === 4) {
    return { v6: false, n: ip.split('.').reduce((acc, p) => (acc << 8n) | BigInt(Number(p)), 0n) };
  }
  if (kind === 6) {
    let [head, tail] = ip.toLowerCase().split('::') as [string, string | undefined];
    // IPv4 no fim (::ffff:1.2.3.4).
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
    const conv = (part: string) =>
      part
        .split(':')
        .filter(Boolean)
        .flatMap((g) => {
          if (g.includes('.')) {
            const n = ipValue(g)!.n;
            return [Number(n >> 16n), Number(n & 0xffffn)];
          }
          return [parseInt(g, 16)];
        });
    if (v4) {
      head = head.replace(v4, '');
      tail = tail?.replace(v4, '');
    }
    const a = conv(head);
    const b = tail === undefined ? [] : conv(tail);
    if (v4 && tail === undefined) a.push(...conv(v4));
    else if (v4) b.push(...conv(v4));
    const groups = [...a, ...Array<number>(8 - a.length - b.length).fill(0), ...b];
    return { v6: true, n: groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n) };
  }
  return null;
}

function cidrMatcher(cidr: string): (value: string) => boolean {
  const [net, bitsText] = cidr.split('/');
  const base = ipValue(net);
  const total = base?.v6 ? 128 : 32;
  const bits = bitsText === undefined ? total : Number(bitsText);
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > total) {
    throw new SigmaUnsupported(`cidr inválido: ${cidr}`);
  }
  const shift = BigInt(total - bits);
  return (value) => {
    const ip = ipValue(value);
    return Boolean(ip && ip.v6 === base.v6 && ip.n >> shift === base.n >> shift);
  };
}

/** Python -> JavaScript: (?i) no comeco vira a flag; (?P<n> vira (?<n>. */
function pythonRegex(source: string, flags: string): RegExp {
  let src = source;
  let f = flags;
  const inline = /^\(\?([imsx]+)\)/.exec(src);
  if (inline) {
    if (inline[1].includes('x')) throw new SigmaUnsupported('regex com (?x)');
    f += [...inline[1]].filter((c) => !f.includes(c)).join('');
    src = src.slice(inline[0].length);
  }
  src = src.replace(/\(\?P</g, '(?<').replace(/\(\?P=(\w+)\)/g, '\\k<$1>');
  try {
    return new RegExp(src, f);
  } catch {
    throw new SigmaUnsupported(`regex que o JavaScript não aceita: ${source.slice(0, 80)}`);
  }
}

/** Os campos do evento por nome em minusculas (GUID/Guid no Sysmon), montado uma vez por evento. */
const lowerCache = new WeakMap<object, Map<string, string | null>>();

/** Os valores de um evento para um campo (o EventID e numero; o resto, texto). */
function fieldValue(e: SigmaEvent, field: string): string | null {
  if (field === 'EventID') return String(e.eventId);
  const v = e.data[field];
  if (v !== undefined) return v ?? null;
  let lower = lowerCache.get(e.data);
  if (!lower) {
    lower = new Map(Object.entries(e.data).map(([k, value]) => [k.toLowerCase(), value ?? null]));
    lowerCache.set(e.data, lower);
  }
  return lower.get(field.toLowerCase()) ?? null;
}

/** Um campo com os modificadores e os valores -> matcher. */
function fieldMatcher(spec: string, raw: unknown): Matcher {
  const [field, ...mods] = spec.split('|');
  for (const m of mods) if (!MODIFIERS.has(m)) throw new SigmaUnsupported(`modificador ${m}`);
  const has = (m: string) => mods.includes(m);
  const values = Array.isArray(raw) ? raw : [raw];
  if (!values.length) throw new SigmaUnsupported(`campo ${field} sem valores`);

  if (has('exists')) {
    const want = values[0] === true || values[0] === 'true';
    return (e) => (fieldValue(e, field) !== null) === want;
  }

  if (has('fieldref')) {
    if (mods.length > 1) throw new SigmaUnsupported('fieldref com outros modificadores');
    const refs = values.map(String);
    return (e) => {
      const v = fieldValue(e, field);
      return v !== null && refs.some((r) => fieldValue(e, r)?.toLowerCase() === v.toLowerCase());
    };
  }

  type Test = (v: string | null) => boolean;
  /** Cada valor vira um trecho de regex (texto, com os curingas) ou um teste proprio. */
  const parts: (Test | { src: string })[] = values.map((value): Test | { src: string } => {
    if (value === null) return (v) => v === null || v === '';
    if (has('gt') || has('gte') || has('lt') || has('lte')) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new SigmaUnsupported('comparação com valor que não é número');
      return (v) => {
        const x = v === null ? NaN : Number(v);
        if (!Number.isFinite(x)) return false;
        return has('gt') ? x > n : has('gte') ? x >= n : has('lt') ? x < n : x <= n;
      };
    }
    if (has('cidr')) {
      const inNet = cidrMatcher(String(value));
      return (v) => v !== null && inNet(v);
    }
    if (typeof value === 'object') throw new SigmaUnsupported(`valor estruturado em ${field}`);
    const text = String(value);
    if (has('re')) {
      const rx = pythonRegex(
        text,
        (has('i') ? 'i' : '') + (has('m') ? 'm' : '') + (has('s') ? 's' : ''),
      );
      return (v) => v !== null && rx.test(v);
    }
    // Codificacoes: o texto vira o Base64 dele (UTF-16LE com wide/utf16le).
    let variants: string[];
    if (has('base64') || has('base64offset')) {
      const bytes =
        has('wide') || has('utf16le') ? Buffer.from(text, 'utf16le') : Buffer.from(text);
      variants = has('base64offset') ? base64Offsets(bytes) : [bytes.toString('base64')];
      // O Base64 nao tem curinga: escapa o que pareceria um.
      variants = variants.map((x) => x.replace(/[*?\\]/g, '\\$&'));
    } else {
      if (has('wide') || has('utf16le')) throw new SigmaUnsupported('wide sem base64');
      variants = [text];
    }
    // Sem ancora no contains: a regex procura o trecho, sem [\s\S]* nas pontas (que custa caro).
    const src = variants
      .map((x) => {
        let body = wildcardSource(x);
        // Traco ou barra no comeco de uma palavra (o parametro): qualquer um dos cinco.
        if (has('windash')) body = body.replace(/(^|\s)(?:\\-|\\\/)/g, `$1${WINDASH}`);
        return has('contains')
          ? `(?:${body})`
          : has('startswith')
            ? `^(?:${body})`
            : has('endswith')
              ? `(?:${body})$`
              : `^(?:${body})$`;
      })
      .join('|');
    return { src };
  });
  const flags = has('cased') ? '' : 'i';
  const toTest = (srcs: string[]): Test => {
    const rx = new RegExp(srcs.join('|'), flags);
    return (v) => v !== null && rx.test(v);
  };

  if (has('all')) {
    // Todos os valores: um teste por valor.
    const tests = parts.map((p) => ('src' in p ? toTest([p.src]) : p));
    return (e) => {
      const v = fieldValue(e, field);
      return tests.every((t) => t(v));
    };
  }
  // Qualquer valor: os trechos viram uma regex so (listas de 50 caminhos sao comuns).
  const srcs = parts.flatMap((p) => ('src' in p ? [p.src] : []));
  const tests = [
    ...(srcs.length ? [toTest(srcs)] : []),
    ...parts.filter((p): p is Test => !('src' in p)),
  ];
  return (e) => {
    const v = fieldValue(e, field);
    return tests.some((t) => t(v));
  };
}

/** Um item da detecao: mapa (todos os campos), ou lista de mapas (qualquer um). */
function detectionMatcher(name: string, item: unknown): Matcher {
  if (Array.isArray(item)) {
    if (item.some((x) => typeof x !== 'object' || x === null || Array.isArray(x))) {
      throw new SigmaUnsupported(`keywords em ${name}`);
    }
    const maps = item.map((x, i) => detectionMatcher(`${name}[${i}]`, x));
    return (e) => maps.some((m) => m(e));
  }
  if (!item || typeof item !== 'object') throw new SigmaUnsupported(`keywords em ${name}`);
  const fields = Object.entries(item as Record<string, unknown>).map(([k, v]) =>
    fieldMatcher(k, v),
  );
  return (e) => fields.every((f) => f(e));
}

// ------------------------------------------------------------------ condicao

type Token = { kind: 'word' | '(' | ')'; text: string };

function tokenize(condition: string): Token[] {
  const tokens: Token[] = [];
  for (const m of condition.matchAll(/\(|\)|[^\s()]+/g)) {
    const text = m[0];
    tokens.push(text === '(' || text === ')' ? { kind: text, text } : { kind: 'word', text });
  }
  return tokens;
}

/** Os nomes da detecao que um padrao (sel*, them) cobre. */
function namesFor(pattern: string, names: string[]): string[] {
  if (pattern === 'them') return names.filter((n) => !n.startsWith('_'));
  const rx = new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
  const found = names.filter((n) => rx.test(n));
  if (!found.length) throw new SigmaUnsupported(`condição cita ${pattern}, que não existe`);
  return found;
}

/** Condicao Sigma (sem agregacao) -> matcher. Gramatica: or > and > not > atomo. */
function conditionMatcher(condition: string, detections: Map<string, Matcher>): Matcher {
  if (condition.includes('|')) throw new SigmaUnsupported('condição com agregação');
  const tokens = tokenize(condition);
  const names = [...detections.keys()];
  let pos = 0;
  const peek = () => tokens[pos];
  const word = (w: string) => peek()?.kind === 'word' && peek().text.toLowerCase() === w;

  const orExpr = (): Matcher => {
    const parts = [andExpr()];
    while (word('or')) {
      pos++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? parts[0] : (e) => parts.some((p) => p(e));
  };
  const andExpr = (): Matcher => {
    const parts = [notExpr()];
    while (word('and')) {
      pos++;
      parts.push(notExpr());
    }
    return parts.length === 1 ? parts[0] : (e) => parts.every((p) => p(e));
  };
  const notExpr = (): Matcher => {
    if (word('not')) {
      pos++;
      const inner = notExpr();
      return (e) => !inner(e);
    }
    return atom();
  };
  const atom = (): Matcher => {
    const t = peek();
    if (!t) throw new SigmaUnsupported('condição incompleta');
    if (t.kind === '(') {
      pos++;
      const inner = orExpr();
      if (peek()?.kind !== ')') throw new SigmaUnsupported('parênteses sem fechar');
      pos++;
      return inner;
    }
    if (t.kind === ')') throw new SigmaUnsupported('parêntese sobrando');
    const quantifier = t.text.toLowerCase();
    if (
      (quantifier === '1' || quantifier === 'all' || quantifier === 'any') &&
      tokens[pos + 1]?.text === 'of'
    ) {
      const target = tokens[pos + 2];
      if (!target || target.kind !== 'word') throw new SigmaUnsupported('"of" sem alvo');
      pos += 3;
      const parts = namesFor(target.text, names).map((n) => detections.get(n)!);
      return quantifier === 'all'
        ? (e) => parts.every((p) => p(e))
        : (e) => parts.some((p) => p(e));
    }
    const found = detections.get(t.text);
    if (!found) throw new SigmaUnsupported(`condição cita ${t.text}, que não existe`);
    pos++;
    return found;
  };

  const result = orExpr();
  if (pos !== tokens.length) throw new SigmaUnsupported(`sobra na condição: ${tokens[pos].text}`);
  return result;
}

// ------------------------------------------------------------------ regra

const text = (v: unknown, max = 2000) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const texts = (v: unknown, max = 20) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').slice(0, max);

/** Tag attack.t1059.001 -> T1059.001. */
export function attackTechniques(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((t) => /^attack\.(t\d{4}(?:\.\d{3})?)$/i.exec(t)?.[1]?.toUpperCase())
        .filter((t): t is string => Boolean(t)),
    ),
  ];
}

/** Compila uma regra (YAML). Lanca SigmaUnsupported com o motivo quando nao da. */
export function compileSigma(yamlText: string, path: string): SigmaRule {
  let doc: Record<string, unknown>;
  try {
    doc = parse(yamlText, { maxAliasCount: 50 }) as Record<string, unknown>;
  } catch (err) {
    throw new SigmaUnsupported(`YAML inválido: ${(err as Error).message.slice(0, 120)}`);
  }
  if (!doc || typeof doc !== 'object') throw new SigmaUnsupported('YAML vazio');
  if (doc.correlation) throw new SigmaUnsupported('regra de correlação');
  const id = text(doc.id, 100);
  const title = text(doc.title, 300);
  if (!id || !title) throw new SigmaUnsupported('regra sem id ou título');
  const level = (LEVELS.includes(doc.level as SigmaLevel) ? doc.level : 'medium') as SigmaLevel;
  const source = sigmaEventIds(doc.logsource as Record<string, unknown> | undefined);

  const detection = doc.detection as Record<string, unknown> | undefined;
  if (!detection || typeof detection !== 'object') throw new SigmaUnsupported('sem detection');
  const conditions = Array.isArray(detection.condition)
    ? detection.condition
    : [detection.condition];
  if (!conditions.length || conditions.some((c) => typeof c !== 'string')) {
    throw new SigmaUnsupported('condição ausente');
  }
  if (detection.timeframe) throw new SigmaUnsupported('janela de tempo (timeframe)');
  const detections = new Map<string, Matcher>();
  for (const [name, item] of Object.entries(detection)) {
    if (name === 'condition' || name === 'timeframe') continue;
    detections.set(name, detectionMatcher(name, item));
  }
  const parts = (conditions as string[]).map((c) => conditionMatcher(c, detections));
  const ids = new Set(source.ids);
  const eventType = source.eventType;
  const match: Matcher = (e) =>
    (ids.size === 0 || ids.has(e.eventId)) &&
    (!eventType || eventType.includes(e.data.EventType ?? '')) &&
    parts.some((p) => p(e));

  const tags = texts(doc.tags, 50);
  return {
    id,
    title,
    level,
    status: text(doc.status, 30),
    description: text(doc.description),
    author: text(doc.author, 300),
    techniques: attackTechniques(tags),
    references: texts(doc.references, 5).filter((r) => /^https?:\/\//.test(r)),
    falsepositives: texts(doc.falsepositives, 5),
    eventIds: source.ids,
    path,
    match,
  };
}
