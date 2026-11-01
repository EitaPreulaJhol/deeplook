const BASE = '/api';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const NETWORK_ERROR =
  'Não foi possível falar com o servidor. Confira a sua conexão e tente de novo.';

/** Corpo da resposta: dados, ou ApiError com a mensagem para a pessoa. */
function parseResponse<T>(status: number, ok: boolean, text: string): T {
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Pagina HTML do proxy (ex.: 502 com a API ainda subindo) ou resposta truncada.
    const message =
      status === 502 || status === 503 || status === 504
        ? `A API não respondeu (erro ${status}). Se o DeepLook acabou de ser iniciado, aguarde alguns segundos e tente de novo.`
        : `Resposta inesperada do servidor (erro ${status}).`;
    throw new ApiError(message, status, null);
  }

  if (!ok) {
    const error = (data as { error?: unknown } | null)?.error;
    const message = (typeof error === 'string' && error) || `Erro ${status}`;
    throw new ApiError(message, status, data);
  }

  return data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options;
  const isForm = typeof FormData !== 'undefined' && rest.body instanceof FormData;

  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(rest.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
  }).catch((err: unknown) => {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(NETWORK_ERROR, 0, null);
  });

  if (res.status === 204) return undefined as T;

  return parseResponse<T>(res.status, res.ok, await res.text());
}

/** Envio de arquivo com o percentual (o fetch nao informa o progresso do envio). */
function upload<T>(
  path: string,
  form: FormData,
  onProgress: (percent: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.floor((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_ERROR, 0, null));
    xhr.onload = () => {
      try {
        const ok = xhr.status >= 200 && xhr.status < 300;
        resolve(parseResponse<T>(xhr.status, ok, xhr.responseText));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    xhr.send(form);
  });
}

/**
 * Erros por campo de uma resposta 400 da API (`details`: { campo: [mensagem] }),
 * ou null se o erro nao trouxer detalhes.
 */
export function apiFieldErrors(err: unknown): Record<string, string[]> | null {
  if (!(err instanceof ApiError)) return null;
  const details = (err.data as { details?: unknown } | null)?.details;
  if (!details || typeof details !== 'object') return null;
  return details as Record<string, string[]>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  upload,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
