import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { env, proxmoxMock } from '../env';
import { pveMock, pveMockScreenshot, pveMockUploadIso } from './proxmox-mock';

export class ProxmoxError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ProxmoxError';
    this.status = status;
  }
}

export type PveMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface PveRequestOptions {
  method?: PveMethod;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

interface Ticket {
  cookie: string;
  csrf: string;
  expiresAt: number;
}

interface RawResponse {
  status: number;
  body: Buffer;
}

let cachedTicket: Ticket | null = null;

export function apiBase(): string {
  return env.PROXMOX_API_URL.replace(/\/+$/, '');
}

export function pveNode(): string {
  return env.PROXMOX_NODE;
}

export function pveVerifyTls(): boolean {
  return env.PROXMOX_VERIFY_TLS === 'true';
}

/**
 * Ticket do PVE.
 * Endpoints de console (vncproxy/vncwebsocket) NAO aceitam API token, entao
 * autenticamos com um usuario dedicado e mantemos o ticket em cache.
 */
async function getTicket(force = false): Promise<Ticket> {
  if (!force && cachedTicket && cachedTicket.expiresAt > Date.now() + 60_000) {
    return cachedTicket;
  }

  const form = new URLSearchParams({
    username: env.PROXMOX_USER,
    password: env.PROXMOX_PASSWORD,
  });

  const res = await httpRequest(
    'POST',
    '/api2/json/access/ticket',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    form.toString(),
    20_000,
  );

  const json = parseJson(res.body) as {
    data?: { ticket?: string; CSRFPreventionToken?: string };
  } | null;
  const ticket = json?.data?.ticket;
  const csrf = json?.data?.CSRFPreventionToken;

  if (res.status >= 400 || !ticket || !csrf) {
    throw new ProxmoxError(
      `Falha ao autenticar no Proxmox (HTTP ${res.status}). Confira PROXMOX_USER e PROXMOX_PASSWORD.`,
    );
  }

  cachedTicket = {
    // O valor vai cru: o ticket do PVE ja e seguro em cookie e o PVE nao
    // espera percent-encoding aqui.
    cookie: `PVEAuthCookie=${ticket}`,
    csrf,
    expiresAt: Date.now() + 100 * 60_000, // tickets do PVE valem ~2h
  };

  return cachedTicket;
}

export async function pveAuth(): Promise<{ cookie: string; csrf: string }> {
  const t = await getTicket();
  return { cookie: t.cookie, csrf: t.csrf };
}

function formEncode(body: Record<string, unknown>): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return form.toString();
}

function parseJson(buf: Buffer): unknown {
  const text = buf.toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessage(status: number, json: unknown, fallback: string): string {
  const errors = (json as { errors?: Record<string, string> } | null)?.errors;
  if (errors) {
    const parts = Object.entries(errors).map(([field, msg]) => `${field}: ${msg}`);
    if (parts.length) return `Proxmox: ${parts.join(' | ')}`;
  }
  const detail = fallback ? ` (${fallback.slice(0, 200)})` : '';
  return `Proxmox respondeu HTTP ${status}${detail}.`;
}

function httpRequest(
  method: PveMethod,
  path: string,
  headers: Record<string, string>,
  body?: string | Readable,
  timeoutMs = 60_000,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const base = new URL(apiBase());
    const isHttps = base.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || (isHttps ? 443 : 80),
        path,
        method,
        headers,
        rejectUnauthorized: pveVerifyTls(),
        timeout: timeoutMs,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );

    req.on('timeout', () => {
      req.destroy(new ProxmoxError('Timeout ao falar com o Proxmox.', 504));
    });
    req.on('error', (err) => reject(err));

    if (body === undefined) {
      req.end();
    } else if (typeof body === 'string') {
      req.end(body);
    } else {
      body.on('error', (err) => req.destroy(err));
      body.pipe(req);
    }
  });
}

/** Chama a API do PVE e devolve o campo `data`. */
export async function pve<T>(path: string, opts: PveRequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';

  if (proxmoxMock) return (await pveMock(path, method, opts.body)) as T;

  const call = async (retry: boolean): Promise<T> => {
    const ticket = await getTicket(retry);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Cookie: ticket.cookie,
    };
    let body: string | undefined;
    if (opts.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers.CSRFPreventionToken = ticket.csrf;
      body = formEncode(opts.body);
    }

    const res = await httpRequest(method, `/api2/json${path}`, headers, body, opts.timeoutMs);
    const json = parseJson(res.body);

    // Ticket expirado no meio do caminho: renova e tenta uma vez.
    if (res.status === 401 && !retry) return call(true);

    if (res.status >= 400 || (json as { errors?: unknown } | null)?.errors) {
      throw new ProxmoxError(errorMessage(res.status, json, res.body.toString('utf8')));
    }
    return ((json as { data?: unknown } | null)?.data ?? null) as T;
  };

  return call(false);
}

/** Igual a `pve`, mas devolve o corpo cru (ex.: screenshot PNG do console). */
export async function pveRaw(
  path: string,
  opts: PveRequestOptions = {},
): Promise<{ status: number; body: Buffer; contentType: string }> {
  if (proxmoxMock) {
    return { status: 200, body: pveMockScreenshot(), contentType: 'image/png' };
  }

  const ticket = await getTicket();
  const headers: Record<string, string> = { Cookie: ticket.cookie };
  let body: string | undefined;
  if (opts.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.CSRFPreventionToken = ticket.csrf;
    body = formEncode(opts.body);
  }
  const res = await httpRequest(opts.method ?? 'GET', `/api2/json${path}`, headers, body);
  return { status: res.status, body: res.body, contentType: 'image/png' };
}

/**
 * Sobe um ISO para o storage do PVE com multipart em streaming
 * (nao carrega a amostra inteira em memoria). Devolve o UPID da task.
 */
export async function pveUploadIso(
  filename: string,
  source: Readable,
  size: number,
): Promise<string> {
  if (proxmoxMock) return pveMockUploadIso(filename, size);

  const ticket = await getTicket();
  const boundary = `----deeplook${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="content"\r\n\r\niso\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="filename"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const payload = Readable.from(
    (async function* stream() {
      yield head;
      for await (const chunk of source) yield chunk as Buffer;
      yield tail;
    })(),
  );

  const res = await httpRequest(
    'POST',
    `/api2/json/nodes/${pveNode()}/storage/${env.PROXMOX_ISO_STORAGE}/upload`,
    {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(head.length + size + tail.length),
      Cookie: ticket.cookie,
      CSRFPreventionToken: ticket.csrf,
    },
    payload,
    60 * 60_000,
  );

  const json = parseJson(res.body);
  if (res.status >= 400) {
    throw new ProxmoxError(errorMessage(res.status, json, res.body.toString('utf8')));
  }
  const upid = (json as { data?: string } | null)?.data;
  if (!upid) throw new ProxmoxError('Proxmox nao retornou a task do upload do ISO.');
  return upid;
}

/** Aguarda uma task do PVE terminar (clone/start/upload...). */
export async function waitTask(upid: string, timeoutMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await pve<{ status: string; exitstatus?: string }>(
      `/nodes/${pveNode()}/tasks/${encodeURIComponent(upid)}/status`,
    );
    if (status?.status === 'stopped') {
      if (status.exitstatus && status.exitstatus !== 'OK') {
        throw new ProxmoxError(`Task do Proxmox terminou com erro: ${status.exitstatus}`);
      }
      return;
    }
    if (Date.now() > deadline) {
      throw new ProxmoxError('Timeout aguardando a task do Proxmox.', 504);
    }
    await sleep(1000);
  }
}

/** Cria o proxy VNC da VM e devolve a porta + ticket do console. */
export async function createVncProxy(vmid: number): Promise<{ port: number; ticket: string }> {
  const data = await pve<{ port?: number; ticket?: string }>(
    `/nodes/${pveNode()}/qemu/${vmid}/vncproxy`,
    { method: 'POST', body: { websocket: true } },
  );
  if (!data?.port || !data?.ticket) {
    throw new ProxmoxError('Proxmox nao retornou porta/ticket do console.');
  }
  return { port: data.port, ticket: data.ticket };
}

/** URL do websocket do console (usada apenas no backend). */
export function pveConsoleWsUrl(vmid: number, port: number, ticket: string): string {
  const base = apiBase().replace(/^http/, 'ws');
  const query = new URLSearchParams({ port: String(port), vncticket: ticket });
  return `${base}/api2/json/nodes/${pveNode()}/qemu/${vmid}/vncwebsocket?${query.toString()}`;
}

/** Origem do PVE (proxies podem validar o header Origin no upgrade). */
export function pveOrigin(): string {
  return apiBase();
}

/** Checagem de saude usada pelo endpoint /api/sandbox/health. */
export async function pveVersion(): Promise<string> {
  const data = await pve<{ version?: string; release?: string }>('/version');
  return data?.version ? `${data.version}${data.release ? `-${data.release}` : ''}` : 'desconhecida';
}

export async function pveTemplateExists(vmid: number): Promise<boolean> {
  try {
    await pve<unknown>(`/nodes/${pveNode()}/qemu/${vmid}/status/current`);
    return true;
  } catch {
    return false;
  }
}

export async function pveStorageSupportsIso(storage: string): Promise<boolean> {
  const data = await pve<{ content?: string }>(`/nodes/${pveNode()}/storage/${storage}/status`);
  return (data?.content ?? '').split(',').includes('iso');
}


