// Proxy de saida do navegador isolado (item 80). Todo trafego do Chromium passa
// por aqui: o nome e resolvido UMA vez, o endereco e conferido (nada de rede
// interna, loopback, link-local, metadados de nuvem...) e a conexao vai para o
// IP conferido, sem nova resolucao (sem DNS rebinding).
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';

/** Faixas que o navegador nunca alcanca. */
const BLOCKED = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // Sem ::ffff:0:0/96: o BlockList compara IPv4 tambem com regras mapeadas, e ela
  // bloquearia todo IPv4. O mapeado ja e conferido pelas faixas IPv4 acima.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo: embute um IPv4
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4: embute um IPv4
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** O endereco e interno/reservado? */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return true;
}

/**
 * Resolve o host e devolve o IP liberado ou lanca. `allowHosts` (so para os
 * testes, vazio em producao) libera nomes exatos mesmo em rede interna.
 */
export async function resolvePublic(host, allowHosts) {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  const literal = net.isIP(name) ? [{ address: name }] : null;
  const addresses = literal ?? (await lookup(name, { all: true, verbatim: true }));
  if (!addresses.length) throw new Error(`${name}: sem endereço`);
  if (allowHosts.has(name)) return addresses[0].address;
  // Todos precisam ser publicos: um nome com IP publico e privado tambem sai.
  const bad = addresses.find((a) => isBlockedAddress(a.address));
  if (bad) throw new Error(`${name} aponta para endereço interno (${bad.address})`);
  return addresses[0].address;
}

/**
 * Sobe o proxy em 127.0.0.1 (porta livre). `onBlocked(host, motivo)` anota o que
 * foi recusado. Devolve { port, close }.
 */
export async function startProxy({ allowHosts = new Set(), onBlocked = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    // Pedido HTTP comum (forma absoluta: GET http://host/caminho).
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    let ip;
    try {
      ip = await resolvePublic(target.hostname, allowHosts);
    } catch (err) {
      onBlocked(target.hostname, err.message);
      res.writeHead(403, { 'content-type': 'text/plain' }).end('bloqueado');
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    const upstream = http.request(
      {
        host: ip,
        port: target.port || 80,
        method: req.method,
        path: target.pathname + target.search,
        headers,
        timeout: 20_000,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('tempo esgotado')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // HTTPS: tunel CONNECT para o IP conferido (o TLS continua ponta a ponta).
  server.on('connect', async (req, client, head) => {
    const [host, portText] = splitHostPort(req.url);
    const port = Number(portText) || 443;
    let ip;
    try {
      ip = await resolvePublic(host, allowHosts);
    } catch (err) {
      onBlocked(host, err.message);
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: ip, port, timeout: 20_000 }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function splitHostPort(value) {
  const v6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return [v6[1], v6[2]];
  const i = value.lastIndexOf(':');
  return i < 0 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
}
