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
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Pagina HTML do proxy (ex.: 502 com a API ainda subindo) ou resposta truncada.
    const message =
      res.status === 502 || res.status === 503 || res.status === 504
        ? `A API não respondeu (erro ${res.status}). Se o DeepLook acabou de ser iniciado, aguarde alguns segundos e tente de novo.`
        : `Resposta inesperada do servidor (erro ${res.status}).`;
    throw new ApiError(message, res.status, null);
  }

  if (!res.ok) {
    const error = (data as { error?: unknown } | null)?.error;
    const message = (typeof error === 'string' && error) || `Erro ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
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
