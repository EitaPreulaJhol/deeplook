// Navegador isolado para capturar a pagina de um link (item 80). Recebe
// POST /capture { url } (com o token da API), abre a pagina num Chromium cujo
// trafego passa pelo proxy de saida (sem rede interna) e devolve print, HTML,
// redirecionamentos e certificado. Uma captura por vez; contexto novo a cada uma, e (item 6.17)
// um container novo a cada uma: depois de responder, o processo sai e o Docker sobe outro.
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { chromium } from 'playwright';

import { parseUpstream, startProxy } from './proxy.mjs';

const PORT = Number(process.env.PORT || 3100);
const TOKEN = process.env.CAPTURE_TOKEN || '';
/** So para testes: nomes liberados mesmo em rede interna (vazio em producao). */
const ALLOW_HOSTS = new Set(
  (process.env.CAPTURE_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
/**
 * Sandbox do proprio Chromium (item 6.16): cada renderizador num user/pid/net namespace com o
 * filtro seccomp do Chromium. E o que segura uma pagina que explore o renderizador: sem ele,
 * a falha ja da codigo no container. Precisa do perfil seccomp do compose
 * (seccomp-chromium.json); `false` so como saida de emergencia num host sem user namespaces.
 */
const SANDBOX = process.env.CAPTURE_CHROMIUM_SANDBOX !== 'false';
/**
 * Um container por captura (item 6.17): depois de responder, o processo sai e o Docker
 * (restart: unless-stopped) sobe outro. Com a raiz somente leitura e o /tmp em tmpfs, nada da
 * captura anterior sobra: nem arquivo, nem processo que uma pagina tenha deixado rodando. Enquanto
 * isso, novos pedidos recebem 503 e a API tenta de novo. `false` volta ao processo de longa vida.
 */
const RECYCLE = process.env.CAPTURE_RECYCLE !== 'false';
/**
 * Proxy de saida (item 6.19, `http://egress:3128` no compose). A rede da captura nao tem saida:
 * o proxy daqui repassa tudo a ele, que resolve o nome e recusa rede interna. Vazio (fora do
 * compose), o proxy daqui resolve e confere sozinho, como antes.
 */
const UPSTREAM = parseUpstream(process.env.CAPTURE_EGRESS_PROXY || '');
/**
 * O Docker dobra a espera para reiniciar um container que viveu menos de 10 s (0,1 s, 0,2 s,
 * 0,4 s...); com 10 s ou mais, reinicia na hora. Medido no item 6.17.
 */
const MIN_UPTIME_MS = 10_500;
const NAV_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1500;
const MAX_HTML = 2 * 1024 * 1024;
const MAX_SHOT_HEIGHT = 6000;
/** Teto da captura inteira, abaixo dos 90 s que a API espera. */
const CAPTURE_DEADLINE_MS = 60_000;

if (!TOKEN || TOKEN.length < 16) {
  console.error('[capture] CAPTURE_TOKEN ausente ou curto (16+ caracteres).');
  process.exit(1);
}

let browser = null;
async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    chromiumSandbox: SANDBOX,
    args: [
      '--disable-quic',
      '--dns-prefetch-disable',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-features=WebRtcHideLocalIpsWithMdns,DnsOverHttps',
      '--no-first-run',
    ],
  });
  return browser;
}

/** Uma captura por vez (fila simples). */
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Contexto novo a cada captura, com todo o trafego pelo proxy de saida. */
async function newContext(proxyPort) {
  const b = await getBrowser();
  return b.newContext({
    proxy: { server: `http://127.0.0.1:${proxyPort}`, bypass: '<-loopback>' },
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    acceptDownloads: false,
    serviceWorkers: 'block',
    javaScriptEnabled: true,
    locale: 'pt-BR',
  });
}

async function capture(url) {
  const blocked = [];
  const proxy = await startProxy({
    allowHosts: ALLOW_HOSTS,
    upstream: UPSTREAM,
    onBlocked: (host, reason) => {
      if (blocked.length < 50 && !blocked.some((b) => b.host === host)) blocked.push({ host, reason });
    },
  });
  // Navegador que nao sobe (ex.: sandbox sem o perfil seccomp) vira erro legivel da captura,
  // e o proxy desta captura fecha junto.
  let context;
  try {
    context = await newContext(proxy.port);
  } catch (err) {
    await proxy.close().catch(() => undefined);
    return { ok: false, error: friendly(String(err?.message || err)).slice(0, 300), blocked };
  }
  try {
    const page = await context.newPage();
    // So http(s): file:, data: de nivel superior, ftp: etc. nao saem.
    await page.route('**/*', (route) => {
      const scheme = route.request().url().split(':')[0].toLowerCase();
      if (scheme === 'http' || scheme === 'https' || scheme === 'data' || scheme === 'blob') {
        return route.continue();
      }
      blocked.push({ host: route.request().url().slice(0, 100), reason: `esquema ${scheme} recusado` });
      return route.abort();
    });
    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);

    // Cadeia de redirecionamentos (do pedido inicial ao final).
    const redirects = [];
    let req = response?.request() ?? null;
    const chain = [];
    while (req) {
      chain.unshift(req);
      req = req.redirectedFrom();
    }
    for (const r of chain) {
      const res = await r.response();
      redirects.push({ url: r.url(), status: res?.status() ?? null });
    }
    // Pagina principal (ou um redirecionamento dela) bloqueada: nao e captura.
    const hosts = new Set([url, ...redirects.map((r) => r.url), page.url()].map(hostOf));
    const stopped = blocked.find((b) => hosts.has(b.host));
    if (stopped) return { ok: false, error: `endereço interno bloqueado: ${stopped.reason}`, blocked };

    const security = response ? await response.securityDetails() : null;
    const certificate = security?.protocol
      ? {
          subject: security.subjectName ?? null,
          issuer: security.issuer ?? null,
          protocol: security.protocol ?? null,
          validFrom: security.validFrom ? new Date(security.validFrom * 1000).toISOString() : null,
          validTo: security.validTo ? new Date(security.validTo * 1000).toISOString() : null,
        }
      : null;

    let html = await page.content();
    const htmlTruncated = Buffer.byteLength(html) > MAX_HTML;
    if (htmlTruncated) html = Buffer.from(html).subarray(0, MAX_HTML).toString('utf8');
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 800);
    const shot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: Math.min(Math.max(height, 800), MAX_SHOT_HEIGHT) },
      fullPage: true,
      timeout: 15_000,
    });
    // Hash perceptual do topo da pagina (o que a pessoa ve ao abrir), para ligar paginas com a
    // mesma aparencia em dominios diferentes. Falhou, a captura segue sem ele.
    const top = await page
      .screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 800 }, timeout: 15_000 })
      .catch(() => null);
    const screenshotHash = top ? await perceptualHash(top).catch(() => null) : null;
    return {
      ok: true,
      screenshotHash,
      finalUrl: page.url(),
      title: (await page.title()).slice(0, 300),
      status: response?.status() ?? null,
      redirects,
      certificate,
      html,
      htmlTruncated,
      screenshot: shot.toString('base64'),
      blocked,
    };
  } catch (err) {
    const message = friendly(String(err?.message || err)).slice(0, 300);
    const internal = blocked.find((b) => b.host === hostOf(url));
    return {
      ok: false,
      error: internal ? `endereço interno bloqueado: ${internal.reason}` : message,
      blocked,
    };
  } finally {
    await context.close().catch(() => undefined);
    await proxy.close().catch(() => undefined);
  }
}

/**
 * dHash de 256 bits do print: miniatura de 17x16 em tons de cinza, um bit por par de vizinhos na
 * linha. A imagem e reduzida num canvas de uma pagina em branco, num contexto novo e sem rede: o
 * JavaScript da pagina capturada nao roda ali e nao tem como mexer no resultado.
 */
async function perceptualHash(png) {
  const b = await getBrowser();
  const context = await b.newContext({ javaScriptEnabled: true, offline: true });
  try {
    const page = await context.newPage();
    return await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(17, 16);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, 17, 16);
      const { data } = ctx.getImageData(0, 0, 17, 16);
      const gray = (x, y) => {
        const i = (y * 17 + x) * 4;
        return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      };
      let hex = '';
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x += 4) {
          let nibble = 0;
          for (let k = 0; k < 4; k++) nibble = (nibble << 1) | (gray(x + k, y) > gray(x + k + 1, y) ? 1 : 0);
          hex += nibble.toString(16);
        }
      }
      return hex;
    }, png.toString('base64'));
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Pagina com laco infinito trava o renderizador, e ler o conteudo dela nao tem
 * tempo-limite: sem este teto, a fila pararia para sempre. Estourou, o navegador
 * inteiro e fechado e a proxima captura abre outro.
 */
async function captureWithDeadline(url) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      const stuck = browser;
      browser = null;
      void stuck?.close().catch(() => undefined);
      resolve({
        ok: false,
        error: `a página travou o navegador (mais de ${CAPTURE_DEADLINE_MS / 1000} s)`,
        blocked: [],
      });
    }, CAPTURE_DEADLINE_MS);
  });
  try {
    return await Promise.race([capture(url), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Erros comuns do Chromium em portugues. */
const ERRORS = [
  [
    /sandboxing failed|No usable sandbox/i,
    'o sandbox do Chromium não subiu neste host (perfil seccomp do compose ou user namespaces desligados)',
  ],
  [/Timeout \d+ms exceeded/, `a página não respondeu em ${NAV_TIMEOUT_MS / 1000} s`],
  [/ERR_NAME_NOT_RESOLVED/, 'domínio não encontrado (DNS)'],
  [/ERR_CONNECTION_REFUSED/, 'conexão recusada'],
  [/ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/, 'o servidor fechou a conexão'],
  [/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/, 'não foi possível conectar ao site'],
  [/ERR_ABORTED/, 'a navegação foi interrompida (download ou bloqueio)'],
];
function friendly(message) {
  const hit = ERRORS.find(([re]) => re.test(message));
  return hit ? hit[1] : message.split('\n')[0];
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/** Compara o cabecalho com o token em tempo constante (como o compare_digest do capa e do unpack). */
function tokenMatches(header) {
  const given = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Ja aceitou a sua captura (com RECYCLE, este processo nao faz outra). */
let used = false;

/** Sai para o Docker subir um container limpo, sem cair no atraso dos reinicios rapidos. */
function recycleSoon() {
  const wait = Math.max(0, MIN_UPTIME_MS - process.uptime() * 1000);
  setTimeout(async () => {
    server.close();
    await browser?.close().catch(() => undefined);
    console.log('[capture] captura entregue: saindo para o Docker subir um container limpo');
    process.exit(0);
  }, wait).unref();
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, {
      ok: true,
      sandbox: SANDBOX,
      recycle: RECYCLE,
      egress: Boolean(UPSTREAM),
      ready: !used,
    });
  }
  if (req.method !== 'POST' || req.url !== '/capture') return send(res, 404, { error: 'rota' });
  if (!tokenMatches(req.headers.authorization)) return send(res, 401, { error: 'token' });
  if (RECYCLE && used) {
    res.setHeader('retry-after', '2');
    return send(res, 503, { error: 'container em troca: tente de novo em instantes' });
  }
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 10_000) req.destroy();
  });
  req.on('end', async () => {
    let url;
    try {
      url = new URL(JSON.parse(raw).url);
    } catch {
      return send(res, 400, { error: 'url inválida' });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return send(res, 400, { error: 'só http e https' });
    }
    // Outro pedido chegou enquanto o corpo deste era lido: so um por container.
    if (RECYCLE && used) {
      res.setHeader('retry-after', '2');
      return send(res, 503, { error: 'container em troca: tente de novo em instantes' });
    }
    if (RECYCLE) {
      used = true;
      // Sai depois que a resposta foi entregue (ou a conexao caiu).
      res.once('close', recycleSoon);
    }
    try {
      send(res, 200, await exclusive(() => captureWithDeadline(url.href)));
    } catch (err) {
      send(res, 500, { ok: false, error: String(err?.message || err).slice(0, 300), blocked: [] });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[capture] ouvindo na porta ${PORT}${RECYCLE ? ' (um container por captura)' : ''}`,
  );
  console.log(
    UPSTREAM
      ? `[capture] saída pelo proxy ${UPSTREAM.hostname}:${UPSTREAM.port} (rede da captura sem saída)`
      : '[capture] sem CAPTURE_EGRESS_PROXY: o proxy local resolve e confere sozinho',
  );
  if (!SANDBOX) {
    console.warn(
      '[capture] CAPTURE_CHROMIUM_SANDBOX=false: renderizadores SEM o sandbox do Chromium. ' +
        'Uma pagina que explore o navegador roda codigo direto no container.',
    );
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await browser?.close().catch(() => undefined);
    process.exit(0);
  });
}
