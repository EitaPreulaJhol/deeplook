/**
 * Cliente dos servicos de analise que trocam de container a cada trabalho: o capa (item 7.2) e o
 * Ghidra (7.3). Os dois tem o mesmo contrato: GET /health diz o estado (livre, analisando,
 * trocando) e POST /analyze recebe o arquivo com o token.
 */

const NOT_CONNECTED = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];

export interface AnalysisService {
  /** Nome nas mensagens ("o serviço capa não respondeu"). */
  name: string;
  url: string;
  token: string;
  /** Quanto esperar a resposta de uma analise. */
  timeoutS: number;
}

/** O servico nao atendeu dentro da espera (fora do ar, ou sempre ocupado). */
export class ServiceUnavailable extends Error {}

function notConnected(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === 'TimeoutError' || err.name === 'AbortError') {
    return false;
  }
  return NOT_CONNECTED.includes((err.cause as { code?: string } | undefined)?.code ?? '');
}

const base = (url: string) => url.replace(/\/$/, '');

/** O servico esta de pe e livre (nao analisando nem trocando de container). */
export async function serviceReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(url)}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      await res.body?.cancel();
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as { state?: string };
    return body.state === undefined || body.state === 'livre';
  } catch {
    return false;
  }
}

/**
 * Manda o arquivo quando o servico estiver livre. Cada analise roda num container novo, e a troca
 * leva alguns segundos: o /health (um GET, seguro de repetir) diz quando o container novo esta
 * pronto, e so entao o arquivo sai. Mandar o POST no meio da troca podia ter a conexao derrubada,
 * o que nao se distingue do arquivo derrubando o container (item 7.2, medido). Conexao que cai
 * depois de aberta NAO e repetida aqui: a fila decide (conta como tentativa).
 */
export async function requestAnalysis(
  service: AnalysisService,
  data: Uint8Array,
  {
    waitMs,
    retryEveryMs,
    query = '',
  }: { waitMs: number; retryEveryMs: number; /** Ex.: "?unpack=0". */ query?: string },
): Promise<Response> {
  const deadline = Date.now() + waitMs;
  const pause = () => new Promise((resolve) => setTimeout(resolve, retryEveryMs));
  const down = `o serviço ${service.name} não respondeu`;
  for (;;) {
    if (!(await serviceReady(service.url))) {
      if (Date.now() >= deadline) throw new ServiceUnavailable(down);
      await pause();
      continue;
    }
    try {
      const res = await fetch(`${base(service.url)}/analyze${query}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${service.token}`,
        },
        body: data,
        signal: AbortSignal.timeout(service.timeoutS * 1000),
      });
      if (res.status !== 503) return res;
      await res.body?.cancel();
      if (Date.now() >= deadline) {
        throw new ServiceUnavailable(`o serviço ${service.name} está ocupado`);
      }
    } catch (err) {
      if (err instanceof ServiceUnavailable) throw err;
      if (!notConnected(err)) throw err;
      if (Date.now() >= deadline) throw new ServiceUnavailable(down);
    }
    await pause();
  }
}

/** Motivo legivel de um pedido que nao voltou (servico fora, tempo esgotado, conexao caida). */
export function requestFailure(service: AnalysisService, err: unknown): string {
  if (err instanceof ServiceUnavailable) return err.message;
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `sem resposta em ${service.timeoutS} s`;
  }
  return 'a conexão com o serviço caiu durante a análise';
}
