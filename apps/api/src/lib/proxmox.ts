import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { env, proxmoxMock } from '../env';
import { pveMock, pveMockScreenshot, pveMockUploadIso } from './proxmox-mock';

export class ProxmoxError extends Error {
  /** Status que a API do DeepLook devolve (502/504). */
  status: number;
  /** Status HTTP devolvido pelo PVE, quando a falha veio de uma resposta dele. */
  pveStatus: number | null;

  constructor(message: string, status = 502, pveStatus: number | null = null) {
    super(message);
    this.name = 'ProxmoxError';
    this.status = status;
    this.pveStatus = pveStatus;
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
    // Lista (ex.: o comando do agent/exec, programa + argumentos): o PVE le a chave repetida.
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
      continue;
    }
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

/**
 * O 403 do PVE nao diz o que falta em todo endpoint (o clone, por exemplo,
 * responde so "Permission check failed"). A dica aponta o privilegio provavel.
 */
function permissionHint(path: string): string {
  if (path.endsWith('/clone')) {
    return (
      'O clone precisa de VM.Clone no template (o VMID do path) e de VM.Allocate em /vms, ' +
      'porque o clone usa um VMID novo; os discos do template tambem exigem ' +
      'Datastore.AllocateSpace no storage de cada um.'
    );
  }
  if (path.endsWith('/upload')) {
    return 'O upload precisa de Datastore.AllocateTemplate no storage da ISO (PROXMOX_ISO_STORAGE).';
  }
  if (path.endsWith('/config')) {
    return 'Alterar a configuracao precisa de VM.Config.* (Options/Disk/CDROM) no VMID alvo.';
  }
  if (path.endsWith('/status/current')) {
    return 'Ler o estado da VM precisa de VM.Audit no VMID alvo.';
  }
  if (path.includes('/status/')) {
    return 'Ligar/desligar precisa de VM.PowerMgmt no VMID alvo.';
  }
  if (path.includes('/tasks/')) {
    return 'Ler a task exige que ela seja sua ou Sys.Audit no node.';
  }
  return '';
}

function errorMessage(
  method: PveMethod,
  path: string,
  status: number,
  json: unknown,
  fallback: string,
): string {
  const body = json as { errors?: Record<string, string>; message?: unknown } | null;
  const errors = body?.errors;
  if (errors) {
    const parts = Object.entries(errors).map(([field, msg]) => `${field}: ${msg}`);
    if (parts.length) return `Proxmox: ${parts.join(' | ')} (${method} ${path})`;
  }
  const pve = typeof body?.message === 'string' ? body.message.trim() : '';
  const detail = pve || fallback.trim().slice(0, 200);
  const detailText = detail ? ` (${detail})` : '';
  // Opcao do template que so o root@pam aplica (o PVE responde 500): o clone nao passa sem ajuste.
  const rootOnly = /only root can set '([\w.-]+)'/.exec(detail)?.[1];
  const hint = rootOnly
    ? `o template tem '${rootOnly}', que no PVE só o root@pam clona. Para hostpci: crie um mapeamento de recurso (Datacenter > Resource Mappings), use-o no template e dê Mapping.Use ao usuário do DeepLook. Para args e outras opções só de root: tire do template ou use outro template.`
    : status === 403
      ? permissionHint(path)
      : '';
  const base = `Proxmox respondeu HTTP ${status} em ${method} ${path}${detailText}.`;
  // A dica depois de um rotulo fixo: o detalhe do PVE costuma ter ponto (ex.: VM.Clone), e a
  // traducao da mensagem (lib/error-language.ts) precisa achar onde a dica comeca.
  return hint ? `${base} Permissões: ${hint}` : base;
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
/**
 * Protecao do template (pedido do dono): nada que mude o estado do template sai daqui. No template
 * so se faz GET e o clone; apagar, ligar, desligar, reconfigurar ou migrar e recusado antes de
 * chegar ao PVE. A checagem e pelo PROXMOX_TEMPLATE_VMID; o apagar de qualquer VM ainda confere,
 * no proprio PVE, se ela nao e um template (outro template no node tambem fica protegido).
 */
export class TemplateProtectedError extends ProxmoxError {}

function vmTarget(path: string): { vmid: number; rest: string } | null {
  const m = /\/qemu\/(\d+)(\/[^?]*)?(?:\?.*)?$/.exec(path);
  return m ? { vmid: Number(m[1]), rest: m[2] ?? '' } : null;
}

function guardTemplate(path: string, method: PveMethod): void {
  if (method === 'GET') return;
  const target = vmTarget(path);
  if (!target || !env.PROXMOX_TEMPLATE_VMID || target.vmid !== env.PROXMOX_TEMPLATE_VMID) return;
  if (method === 'POST' && target.rest === '/clone') return;
  throw new TemplateProtectedError(
    `recusado: o template (VM ${target.vmid}) é protegido; só leitura e clone`,
    409,
  );
}

/** Antes de apagar uma VM: ela nao pode ser um template (flag `template` na configuracao). */
async function guardDelete(path: string, method: PveMethod): Promise<void> {
  const target = vmTarget(path);
  if (method !== 'DELETE' || !target || target.rest !== '') return;
  const node = /\/nodes\/([^/]+)\//.exec(path)?.[1] ?? pveNode();
  const config = await pve<{ template?: number | string }>(
    `/nodes/${node}/qemu/${target.vmid}/config`,
  );
  if (config?.template && String(config.template) !== '0') {
    throw new TemplateProtectedError(
      `recusado: a VM ${target.vmid} é um template e não é apagada`,
      409,
    );
  }
}

export async function pve<T>(path: string, opts: PveRequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  guardTemplate(path, method);
  await guardDelete(path, method);

  if (proxmoxMock) return (await pveMock(path, method, opts.body)) as T;

  const call = async (retry: boolean): Promise<T> => {
    const ticket = await getTicket(retry);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Cookie: ticket.cookie,
    };
    // O PVE exige o CSRFPreventionToken em TODA requisicao que muda estado
    // (POST/PUT/DELETE), mesmo quando nao ha corpo. Sem ele, responde 401.
    if (method !== 'GET') headers.CSRFPreventionToken = ticket.csrf;

    let body: string | undefined;
    if (opts.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = formEncode(opts.body);
    } else if (method !== 'GET') {
      // Garante Content-Length: 0 em POST/PUT/DELETE sem corpo.
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = '';
    }

    const res = await httpRequest(method, `/api2/json${path}`, headers, body, opts.timeoutMs);
    const json = parseJson(res.body);

    // Ticket expirado no meio do caminho: renova e tenta uma vez.
    if (res.status === 401 && !retry) return call(true);

    if (res.status >= 400 || (json as { errors?: unknown } | null)?.errors) {
      throw new ProxmoxError(
        errorMessage(method, path, res.status, json, res.body.toString('utf8')),
        502,
        res.status,
      );
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
  const method = opts.method ?? 'GET';
  guardTemplate(path, method);
  await guardDelete(path, method);
  if (proxmoxMock) {
    return { status: 200, body: pveMockScreenshot(), contentType: 'image/png' };
  }

  const ticket = await getTicket();
  const headers: Record<string, string> = { Cookie: ticket.cookie };
  // CSRF obrigatorio em POST/PUT/DELETE, mesmo sem corpo (senao o PVE responde 401).
  if (method !== 'GET') headers.CSRFPreventionToken = ticket.csrf;
  let body: string | undefined;
  if (opts.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = formEncode(opts.body);
  } else if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = '';
  }
  const res = await httpRequest(method, `/api2/json${path}`, headers, body);
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

  const uploadPath = `/nodes/${pveNode()}/storage/${env.PROXMOX_ISO_STORAGE}/upload`;
  const res = await httpRequest(
    'POST',
    `/api2/json${uploadPath}`,
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
    throw new ProxmoxError(
      errorMessage('POST', uploadPath, res.status, json, res.body.toString('utf8')),
      502,
      res.status,
    );
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
        // A task que falha por permissao nao melhora com outra tentativa: marca 403
        // para o chamador (ex.: o clone) nao cair no fallback de copia cheia.
        const denied = /permission check failed/i.test(status.exitstatus);
        throw new ProxmoxError(
          `Task do Proxmox terminou com erro: ${status.exitstatus}`,
          502,
          denied ? 403 : null,
        );
      }
      return;
    }
    if (Date.now() > deadline) {
      throw new ProxmoxError('Timeout aguardando a task do Proxmox.', 504);
    }
    await sleep(1000);
  }
}

/**
 * Cria o proxy VNC da VM e devolve porta, ticket e a senha do console.
 * O PVE exige auth VNC (tipo 2) no vncwebsocket: a senha vem do proprio
 * vncproxy e e usada pelo noVNC no handshake (RFB.genDES).
 */
export async function createVncProxy(
  vmid: number,
): Promise<{ port: number; ticket: string; password: string }> {
  const data = await pve<{ port?: number; ticket?: string; password?: string }>(
    `/nodes/${pveNode()}/qemu/${vmid}/vncproxy`,
    { method: 'POST', body: { websocket: true } },
  );
  if (!data?.port || !data?.ticket) {
    throw new ProxmoxError('Proxmox nao retornou porta/ticket do console.');
  }
  // Sem senha explicita o PVE usa o inicio do ticket (VNC limita a 8 chars).
  const password = data.password || data.ticket.slice(0, 8);
  return { port: data.port, ticket: data.ticket, password };
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
  return data?.version
    ? `${data.version}${data.release ? `-${data.release}` : ''}`
    : 'desconhecida';
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
