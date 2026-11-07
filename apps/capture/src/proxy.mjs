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

/**
 * Portas que o proprio Chromium recusa (ERR_UNSAFE_PORT): SMTP, SSH, IMAP, IRC, NFS... Medidas,
 * e nao copiadas: o Chromium 156 da imagem do Playwright 1.64.1 navegou para cada porta de 1 a
 * 11000 e recusou exatamente estas 80. O navegador ja as recusa antes do proxy; aqui elas valem
 * para quem nao obedece ao navegador (o egress, item 6.19). Nenhuma outra porta e barrada:
 * phishing em porta alta (8000, 2083...) e comum e precisa ser capturado.
 */
export const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

const unsafePortReason = (port) => `porta ${port} recusada (porta proibida pelo navegador)`;

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
 * Cabecalho com o motivo da recusa. O proxy da captura, encadeado no de saida (item 6.19), le
 * daqui o que anotar na ficha; o navegador ignora.
 */
export const BLOCKED_HEADER = 'x-deeplook-blocked';
const TIMEOUT_MS = 20_000;

/**
 * Sobe o proxy. `onBlocked(host, motivo)` anota o que foi recusado. Devolve { port, close }.
 *
 * - Sem `upstream` (o proxy de saida, ou a captura fora do compose): resolve o nome e conecta no
 *   IP conferido. Por padrao ouve em 127.0.0.1, porta livre.
 * - Com `upstream` ({ hostname, port }, a captura no compose): repassa tudo ao proxy de saida,
 *   que resolve e confere. A rede da captura nao tem saida nem DNS externo (item 6.19): o
 *   Chromium so alcanca a internet por ali, obedeca ele a este proxy ou nao.
 */
export async function startProxy({
  allowHosts = new Set(),
  onBlocked = () => {},
  upstream = null,
  host = '127.0.0.1',
  port = 0,
} = {}) {
  const refuse = (res, name, reason) => {
    onBlocked(name, reason);
    res
      .writeHead(403, {
        'content-type': 'text/plain',
        [BLOCKED_HEADER]: encodeURIComponent(reason.slice(0, 200)),
      })
      .end('bloqueado');
  };

  const server = http.createServer((req, res) => {
    // Um erro aqui nao pode derrubar o processo: o proxy de saida atende todas as capturas.
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  async function handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
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
    const targetPort = Number(target.port) || 80;
    if (UNSAFE_PORTS.has(targetPort)) {
      refuse(res, target.hostname, unsafePortReason(targetPort));
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];

    let options;
    if (upstream) {
      options = { host: upstream.hostname, port: upstream.port, path: target.href };
    } else {
      let ip;
      try {
        ip = await resolvePublic(target.hostname, allowHosts);
      } catch (err) {
        refuse(res, target.hostname, err.message);
        return;
      }
      options = { host: ip, port: target.port || 80, path: target.pathname + target.search };
    }
    const outgoing = http.request(
      { ...options, method: req.method, headers, timeout: TIMEOUT_MS },
      (up) => {
        const reason = up.statusCode === 403 && up.headers[BLOCKED_HEADER];
        if (reason) onBlocked(target.hostname, safeDecode(reason));
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('tempo esgotado')));
    outgoing.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(outgoing);
  }

  // HTTPS: tunel CONNECT para o IP conferido (o TLS continua ponta a ponta).
  server.on('connect', (req, client, head) => {
    client.on('error', () => client.destroy());
    handleConnect(req, client, head).catch(() => client.destroy());
  });

  async function handleConnect(req, client, head) {
    const [name, portText] = splitHostPort(req.url);
    const port = portText === '' ? 443 : Number(portText);
    if (!name || !Number.isInteger(port) || port < 1 || port > 65535) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    if (UNSAFE_PORTS.has(port)) {
      const reason = unsafePortReason(port);
      onBlocked(name, reason);
      client.end(
        `HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: ${encodeURIComponent(reason)}\r\n\r\n`,
      );
      return;
    }
    if (upstream) {
      connectThroughUpstream(name, port, client, head);
      return;
    }
    let ip;
    try {
      ip = await resolvePublic(name, allowHosts);
    } catch (err) {
      onBlocked(name, err.message);
      const reason = encodeURIComponent(err.message.slice(0, 200));
      client.end(`HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: ${reason}\r\n\r\n`);
      return;
    }
    const outgoing = net.connect({ host: ip, port, timeout: TIMEOUT_MS }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) outgoing.write(head);
      outgoing.pipe(client);
      client.pipe(outgoing);
    });
    outgoing.on('timeout', () => outgoing.destroy());
    outgoing.on('error', () => client.destroy());
    client.on('close', () => outgoing.destroy());
  }

  /** O tunel pedido ao proxy de saida; a recusa dele volta com o motivo no cabecalho. */
  function connectThroughUpstream(name, port, client, head) {
    const authority = `${name.includes(':') ? `[${name}]` : name}:${port}`;
    const ask = http.request({
      host: upstream.hostname,
      port: upstream.port,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority },
      timeout: TIMEOUT_MS,
    });
    ask.on('connect', (res, socket, upHead) => {
      if (res.statusCode !== 200) {
        const reason = res.headers[BLOCKED_HEADER];
        if (res.statusCode === 403 && reason) {
          onBlocked(name, safeDecode(reason));
          client.end(`HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: ${reason}\r\n\r\n`);
        } else {
          client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        }
        socket.destroy();
        return;
      }
      socket.setTimeout(0);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (upHead?.length) client.write(upHead);
      if (head?.length) socket.write(head);
      socket.pipe(client);
      client.pipe(socket);
      socket.on('error', () => client.destroy());
      client.on('close', () => socket.destroy());
    });
    ask.on('timeout', () => ask.destroy(new Error('tempo esgotado')));
    ask.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    ask.end();
  }

  await new Promise((resolve) => server.listen(port, host, resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** `http://egress:3128` vira { hostname, port }; vazio, null. */
export function parseUpstream(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:') throw new Error('o proxy de saída precisa ser http://host:porta');
  return { hostname: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 80 };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function splitHostPort(value) {
  const v6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return [v6[1], v6[2]];
  const i = value.lastIndexOf(':');
  return i < 0 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
}
