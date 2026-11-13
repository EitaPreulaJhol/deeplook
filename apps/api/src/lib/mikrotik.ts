import http from 'node:http';
import https from 'node:https';

import { env } from '../env';

/**
 * Sniffer do MikroTik CHR pela API REST do RouterOS 7 (plano pos-revisao, item 5.4). O DeepLook
 * controla o `/tool/sniffer`: a lista de MACs (`filter-mac-address`) e o envio por TZSP
 * (`streaming-server`) para o servico netcap. Mexe so no sniffer; o usuario do RouterOS precisa
 * so das politicas `read`, `write`, `rest-api` e `sniff` (docs/proxmox.pt-BR.md).
 *
 * O sniffer e um so no roteador: cada mudanca para, reconfigura e liga de novo, com a lista inteira
 * dos ambientes que estao capturando. As chamadas sao serializadas (uma de cada vez).
 */

export class MikrotikError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** Uma chamada REST: devolve o JSON (ou null). Lanca MikrotikError com um motivo legivel. */
function rest(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let base: URL;
    try {
      base = new URL(env.MIKROTIK_URL);
    } catch {
      reject(new MikrotikError('MIKROTIK_URL inválido'));
      return;
    }
    const isHttps = base.protocol === 'https:';
    const payload = body ? JSON.stringify(body) : undefined;
    const auth = Buffer.from(`${env.MIKROTIK_USER}:${env.MIKROTIK_PASSWORD}`).toString('base64');
    const req = (isHttps ? https : http).request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || (isHttps ? 443 : 80),
        path: `${base.pathname.replace(/\/$/, '')}/rest${path}`,
        method,
        headers: {
          authorization: `Basic ${auth}`,
          accept: 'application/json',
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
        rejectUnauthorized: env.MIKROTIK_VERIFY_TLS === 'true',
        timeout: TIMEOUT_MS,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* corpo que nao e JSON */
          }
          const status = res.statusCode ?? 0;
          if (status === 401) {
            reject(new MikrotikError('o RouterOS recusou o usuário ou a senha', status));
          } else if (status >= 400) {
            const said = (json as { detail?: unknown } | null)?.detail;
            const detail = typeof said === 'string' ? said.slice(0, 120) : text.slice(0, 120);
            reject(
              new MikrotikError(`o RouterOS não aceitou o pedido (${status}): ${detail}`, status),
            );
          } else {
            resolve(json);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new MikrotikError('o RouterOS não respondeu a tempo')));
    req.on('error', (err) =>
      reject(
        err instanceof MikrotikError
          ? err
          : new MikrotikError(`sem conexão com o RouterOS: ${err.message}`),
      ),
    );
    req.end(payload);
  });
}

export interface SnifferState {
  running: boolean;
  macs: string[];
  streamingServer: string | null;
  version: string | null;
}

const yes = (v: unknown) => v === true || v === 'true' || v === 'yes';

/** O estado do sniffer (e a versao do RouterOS, para o status do sistema). */
export async function snifferState(): Promise<SnifferState> {
  const [sniffer, resource] = await Promise.all([
    rest('GET', '/tool/sniffer') as Promise<Record<string, unknown> | null>,
    (rest('GET', '/system/resource') as Promise<Record<string, unknown> | null>).catch(() => null),
  ]);
  const macs = String(sniffer?.['filter-mac-address'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    running: yes(sniffer?.running),
    macs,
    streamingServer: (sniffer?.['streaming-server'] as string | undefined) ?? null,
    version: (resource?.version as string | undefined) ?? null,
  };
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Deixa o sniffer com exatamente estes MACs: vazio, ele para (sem filtro, gravaria tudo). Com
 * MACs, para, reconfigura e liga (as configuracoes so valem no proximo inicio).
 */
export function syncSniffer(macs: string[]): Promise<void> {
  const run = async () => {
    await rest('POST', '/tool/sniffer/stop', {});
    if (!macs.length) {
      await rest('POST', '/tool/sniffer/set', { 'filter-mac-address': '' });
      return;
    }
    await rest('POST', '/tool/sniffer/set', {
      'filter-mac-address': macs.join(','),
      'streaming-enabled': 'yes',
      'streaming-server': env.NETCAP_STREAM_TARGET,
      // Sem os proprios pacotes do envio TZSP no que vai para o netcap.
      'filter-stream': 'yes',
      'only-headers': 'no',
      ...(env.MIKROTIK_SNIFFER_INTERFACE
        ? { 'filter-interface': env.MIKROTIK_SNIFFER_INTERFACE }
        : {}),
    });
    await rest('POST', '/tool/sniffer/start', {});
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
