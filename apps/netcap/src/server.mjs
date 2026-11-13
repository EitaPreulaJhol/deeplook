// Captura de rede do sandbox (plano pos-revisao, item 5.4). O sniffer do MikroTik CHR manda por
// TZSP (UDP) os pacotes das VMs de analise; este servico separa cada pacote pelo MAC da VM e grava
// um pcap por sessao. A API do DeepLook abre e fecha as sessoes por HTTP, com token:
//
//   POST   /sessions            { id, mac }     comeca a gravar o que tiver esse MAC
//   GET    /sessions                            as sessoes abertas (a API confere na subida)
//   GET    /sessions/:id                        tamanho e pacotes ate agora
//   GET    /sessions/:id/pcap                   o pcap gravado ate agora
//   DELETE /sessions/:id                        para e apaga
//   GET    /health                              sem token: estado, sem MAC nem sessao
//
// So le o cabecalho TZSP e os dois MACs do quadro: o conteudo do pacote nao e interpretado aqui
// (quem le e o Suricata, em outro container). Sem dependencias, sem root, gravando num tmpfs.
import { timingSafeEqual } from 'node:crypto';
import dgram from 'node:dgram';
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { frameMacs, normalizeMac, parseTzsp, pcapHeader, pcapRecord } from './tzsp.mjs';

/** Segredo do ambiente ou, com NOME_FILE, do arquivo (Docker secrets; plano pos-revisao 5.1). */
function secret(name) {
  const path = process.env[`${name}_FILE`];
  if (path) return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  return process.env[name] || '';
}

const PORT = Number(process.env.PORT || 3700);
const TZSP_PORT = Number(process.env.NETCAP_TZSP_PORT || 37008);
const TOKEN = secret('NETCAP_TOKEN');
const DIR = process.env.NETCAP_DIR || '/data';
/** Teto do pcap de uma sessao; passou, para de gravar (e marca como truncado). */
const MAX_BYTES = Number(process.env.NETCAP_MAX_MB || 200) * 1024 * 1024;
const MAX_SESSIONS = Number(process.env.NETCAP_MAX_SESSIONS || 16);
/** Sessao esquecida (a API caiu sem fechar): apagada depois disso. */
const MAX_AGE_MS = Number(process.env.NETCAP_MAX_HOURS || 12) * 3600 * 1000;
/**
 * De quem aceitar TZSP (IPs separados por virgula; vazio aceita de qualquer um). O UDP nao tem
 * autenticacao: com a porta publicada, limitar ao IP do CHR evita pacote forjado no pcap.
 */
const SOURCES = new Set(
  (process.env.NETCAP_TZSP_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const log = (msg) => console.error(`[netcap] ${msg}`);

/** id -> { id, mac, path, fd, bytes, packets, truncated, startedAt, lastPacketAt } */
const sessions = new Map();
/** mac -> id */
const byMac = new Map();
const stats = { datagrams: 0, ignored: 0, rejected: 0, lastPacketAt: null };

const publicSession = (s) => ({
  id: s.id,
  mac: s.mac,
  bytes: s.bytes,
  packets: s.packets,
  truncated: s.truncated,
  startedAt: new Date(s.startedAt).toISOString(),
  lastPacketAt: s.lastPacketAt ? new Date(s.lastPacketAt).toISOString() : null,
});

function openSession(id, mac) {
  const path = join(DIR, `${id}.pcap`);
  const fd = openSync(path, 'w', 0o600);
  const header = pcapHeader();
  writeSync(fd, header);
  const s = {
    id,
    mac,
    path,
    fd,
    bytes: header.length,
    packets: 0,
    truncated: false,
    startedAt: Date.now(),
    lastPacketAt: null,
  };
  sessions.set(id, s);
  byMac.set(mac, id);
  return s;
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (byMac.get(s.mac) === id) byMac.delete(s.mac);
  try {
    closeSync(s.fd);
  } catch {
    /* ja fechado */
  }
  rmSync(s.path, { force: true });
  return true;
}

function record(s, frame) {
  if (s.truncated) return;
  const rec = pcapRecord(frame);
  if (s.bytes + rec.length > MAX_BYTES) {
    s.truncated = true;
    log(`sessao ${s.id}: teto de ${MAX_BYTES >> 20} MB, parou de gravar`);
    return;
  }
  writeSync(s.fd, rec);
  s.bytes += rec.length;
  s.packets += 1;
  s.lastPacketAt = Date.now();
}

/** Um datagrama do sniffer: grava o quadro na sessao do MAC de origem ou de destino. */
export function handleDatagram(msg, from) {
  stats.datagrams += 1;
  if (SOURCES.size && !SOURCES.has(from.address.replace(/^::ffff:/, ''))) {
    stats.rejected += 1;
    return;
  }
  const frame = parseTzsp(msg);
  if (!frame) {
    stats.ignored += 1;
    return;
  }
  const { src, dst } = frameMacs(frame);
  const id = byMac.get(src) ?? byMac.get(dst);
  const s = id && sessions.get(id);
  if (!s) {
    stats.ignored += 1;
    return;
  }
  stats.lastPacketAt = Date.now();
  record(s, frame);
}

function authorized(req) {
  const got = Buffer.from(req.headers.authorization || '');
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const ID = /^[\w-]{1,64}$/;

async function route(req, res) {
  const url = new URL(req.url, 'http://netcap');
  const path = url.pathname;
  if (req.method === 'GET' && path === '/health') {
    return send(res, 200, {
      ok: true,
      state: 'livre',
      sessions: sessions.size,
      tzspPort: TZSP_PORT,
      datagrams: stats.datagrams,
      ignored: stats.ignored,
      rejected: stats.rejected,
      lastPacketAt: stats.lastPacketAt ? new Date(stats.lastPacketAt).toISOString() : null,
    });
  }
  if (!authorized(req)) {
    req.resume();
    return send(res, 401, { error: 'token inválido' });
  }
  if (path === '/sessions' && req.method === 'GET') {
    return send(res, 200, { sessions: [...sessions.values()].map(publicSession) });
  }
  if (path === '/sessions' && req.method === 'POST') {
    const body = await readJson(req);
    const id = typeof body?.id === 'string' && ID.test(body.id) ? body.id : null;
    const mac = normalizeMac(body?.mac);
    if (!id || !mac) return send(res, 400, { error: 'id ou MAC inválido' });
    const existing = sessions.get(id);
    if (existing) {
      if (existing.mac === mac) return send(res, 200, publicSession(existing));
      return send(res, 409, { error: 'a sessão já existe com outro MAC' });
    }
    if (byMac.has(mac)) return send(res, 409, { error: 'o MAC já está em outra sessão' });
    if (sessions.size >= MAX_SESSIONS) {
      return send(res, 429, { error: `limite de ${MAX_SESSIONS} sessões` });
    }
    const s = openSession(id, mac);
    log(`sessao ${id} aberta`);
    return send(res, 201, publicSession(s));
  }
  const m = /^\/sessions\/([^/]+)(\/pcap)?$/.exec(path);
  const s = m && ID.test(m[1]) ? sessions.get(m[1]) : null;
  if (!m) return send(res, 404, { error: 'não encontrado' });
  if (req.method === 'DELETE' && !m[2]) {
    const closed = closeSession(m[1]);
    if (closed) log(`sessao ${m[1]} fechada`);
    res.writeHead(closed ? 204 : 404);
    return res.end();
  }
  if (!s) return send(res, 404, { error: 'sessão não encontrada' });
  if (req.method === 'GET' && !m[2]) return send(res, 200, publicSession(s));
  if (req.method === 'GET' && m[2]) {
    // O tamanho do momento: o que chegar durante o envio fica para o proximo pedido.
    const size = s.bytes;
    res.writeHead(200, {
      'content-type': 'application/vnd.tcpdump.pcap',
      'content-length': size,
      'x-packets': String(s.packets),
      'x-truncated': String(s.truncated),
    });
    createReadStream(s.path, { start: 0, end: size - 1 }).pipe(res);
    return undefined;
  }
  return send(res, 405, { error: 'método não permitido' });
}

function sweep() {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (now - s.startedAt > MAX_AGE_MS) {
      closeSession(s.id);
      log(`sessao ${s.id} esquecida: apagada`);
    }
  }
}

export function start() {
  if (TOKEN.length < 16) {
    log('NETCAP_TOKEN ausente ou curto (16+ caracteres).');
    process.exit(1);
  }
  mkdirSync(DIR, { recursive: true });
  const udp = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 * 1024 * 1024 });
  udp.on('message', (msg, from) => {
    try {
      handleDatagram(msg, from);
    } catch (err) {
      log(`falha num datagrama: ${err.message}`);
    }
  });
  udp.on('error', (err) => {
    log(`UDP: ${err.message}`);
    process.exit(1);
  });
  udp.bind(TZSP_PORT);
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      log(`falha: ${err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'falha interna' });
      else res.destroy();
    });
  });
  server.requestTimeout = 120_000;
  server.listen(PORT, () => log(`HTTP na porta ${PORT}, TZSP na UDP ${TZSP_PORT}`));
  setInterval(sweep, 60_000).unref();
  const stop = () => {
    for (const id of [...sessions.keys()]) closeSession(id);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
