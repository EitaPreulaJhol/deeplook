import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../i18n';
import { api, ApiError, apiFieldErrors } from './client';

const NETWORK_ERROR =
  'Não foi possível falar com o servidor. Confira a sua conexão e tente de novo.';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

/** A proxima chamada ao fetch responde com este corpo e status. */
const reply = (body: string | null, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(body, { status }));

/** Argumentos da primeira chamada ao fetch. */
const firstCall = () => fetchMock.mock.calls[0] as [string, RequestInit];

/** Espera a chamada falhar e devolve o ApiError (se ela der certo, o teste falha). */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('a chamada deveria ter falhado');
}

describe('api: idioma', () => {
  afterEach(() => setLocale('pt-BR'));

  it('manda o idioma da interface no Accept-Language (erros da API no mesmo idioma)', async () => {
    reply(JSON.stringify({ ok: true }));
    await api.get('/me');
    expect((firstCall()[1].headers as Record<string, string>)['Accept-Language']).toBe('pt-BR');
    setLocale('en');
    reply(JSON.stringify({ ok: true }));
    await api.get('/me');
    const second = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((second[1].headers as Record<string, string>)['Accept-Language']).toBe('en');
  });

  it('a falha de rede sai no idioma da interface', async () => {
    setLocale('en');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = await failure(api.get('/me'));
    expect(err.message).toBe('Could not reach the server. Check your connection and try again.');
  });
});

describe('api: resposta', () => {
  it('devolve o JSON e chama /api com os cookies da sessão', async () => {
    reply(JSON.stringify({ ok: true }));
    await expect(api.get('/me')).resolves.toEqual({ ok: true });
    const [url, init] = firstCall();
    expect(url).toBe('/api/me');
    expect(init.credentials).toBe('include');
  });

  it('204 devolve undefined; 200 sem corpo devolve null', async () => {
    reply(null, 204);
    await expect(api.del('/x')).resolves.toBeUndefined();
    reply('');
    await expect(api.get('/x')).resolves.toBeNull();
  });
});

describe('api: erros da API', () => {
  it('usa a mensagem de `error` e guarda o status e os dados', async () => {
    const body = { error: 'Sem permissão', details: { campo: ['obrigatório'] } };
    reply(JSON.stringify(body), 403);
    const err = await failure(api.get('/x'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      name: 'ApiError',
      message: 'Sem permissão',
      status: 403,
      data: body,
    });
  });

  it('sem `error` utilizável cai em "Erro <status>"', async () => {
    for (const body of [{}, { error: '' }, { error: 42 }]) {
      reply(JSON.stringify(body), 500);
      await expect(api.get('/x')).rejects.toMatchObject({ message: 'Erro 500', status: 500 });
    }
  });

  it('página HTML de 502, 503 ou 504 diz que a API pode estar subindo', async () => {
    for (const status of [502, 503, 504]) {
      reply('<html><body>Bad Gateway</body></html>', status);
      const err = await failure(api.get('/x'));
      expect(err.message).toBe(
        `A API não respondeu (erro ${status}). Se o DeepLook acabou de ser iniciado, aguarde alguns segundos e tente de novo.`,
      );
      expect(err.status).toBe(status);
      expect(err.data).toBeNull();
    }
  });

  it('HTML de outro status, ou JSON truncado, vira "resposta inesperada"', async () => {
    reply('<html>erro</html>', 500);
    await expect(api.get('/x')).rejects.toMatchObject({
      message: 'Resposta inesperada do servidor (erro 500).',
    });
    reply('{"truncado":', 200);
    await expect(api.get('/x')).rejects.toMatchObject({
      message: 'Resposta inesperada do servidor (erro 200).',
    });
  });
});

describe('api: falhas antes da resposta', () => {
  it('falha de rede vira ApiError de status 0, com texto para a pessoa', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await failure(api.get('/x'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe(NETWORK_ERROR);
    expect(err.status).toBe(0);
  });

  it('cancelar (AbortError) passa como está: não é falha de rede', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abort);
    await expect(api.get('/x')).rejects.toBe(abort);
  });
});

describe('api: o que vai na requisição', () => {
  it('get não manda Content-Type nem corpo', async () => {
    reply('{}');
    await api.get('/x');
    const [, init] = firstCall();
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ 'Accept-Language': 'pt-BR' });
  });

  it('post manda JSON, com {} quando não há corpo', async () => {
    reply('{}');
    await api.post('/x', { a: 1 });
    reply('{}');
    await api.post('/y');
    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(first).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(second.body).toBe('{}');
  });

  it('post com FormData envia o FormData sem fixar o Content-Type', async () => {
    reply('{}');
    const form = new FormData();
    form.append('arquivo', 'conteudo');
    await api.post('/envio', form);
    const [, init] = firstCall();
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ 'Accept-Language': 'pt-BR' });
  });

  it('patch, put e del usam o método certo', async () => {
    reply('{}');
    await api.patch('/x', { a: 1 });
    reply('{}');
    await api.put('/x', { a: 2 });
    reply('{}');
    await api.del('/x');
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method);
    expect(methods).toEqual(['PATCH', 'PUT', 'DELETE']);
  });
});

describe('apiFieldErrors', () => {
  it('devolve os erros por campo de uma resposta 400', () => {
    const err = new ApiError('inválido', 400, { details: { titulo: ['obrigatório'] } });
    expect(apiFieldErrors(err)).toEqual({ titulo: ['obrigatório'] });
  });

  it('devolve null sem detalhes, com detalhes que não são objeto, ou fora de ApiError', () => {
    expect(apiFieldErrors(new ApiError('x', 400, null))).toBeNull();
    expect(apiFieldErrors(new ApiError('x', 400, { details: 'texto' }))).toBeNull();
    expect(apiFieldErrors(new ApiError('x', 400, {}))).toBeNull();
    expect(apiFieldErrors(new Error('x'))).toBeNull();
    expect(apiFieldErrors('x')).toBeNull();
  });
});

describe('api.upload (XMLHttpRequest)', () => {
  /** XHR mínimo: o teste dispara onprogress/onload/onerror à mão. */
  class FakeXhr {
    static last: FakeXhr;
    upload: {
      onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
    } = {};
    onload?: () => void;
    onerror?: () => void;
    status = 0;
    responseText = '';
    method = '';
    url = '';
    body: unknown;
    headers: Record<string, string> = {};
    constructor() {
      FakeXhr.last = this;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    send(body: unknown) {
      this.body = body;
    }
  }

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  it('envia o formulário por POST e informa o percentual (só quando mensurável)', async () => {
    const form = new FormData();
    const percents: number[] = [];
    const promise = api.upload<{ id: string }>('/entries', form, (p) => percents.push(p));
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/entries');
    expect(xhr.body).toBe(form);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 3 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 3 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 3 });
    expect(percents).toEqual([33, 100]);

    xhr.status = 201;
    xhr.responseText = '{"id":"abc"}';
    xhr.onload?.();
    await expect(promise).resolves.toEqual({ id: 'abc' });
  });

  it('resposta de erro vira ApiError com a mensagem da API', async () => {
    const promise = api.upload('/entries', new FormData(), () => {});
    const xhr = FakeXhr.last;
    xhr.status = 413;
    xhr.responseText = '{"error":"Arquivo grande demais"}';
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ message: 'Arquivo grande demais', status: 413 });
  });

  it('falha de rede vira ApiError de status 0', async () => {
    const promise = api.upload('/entries', new FormData(), () => {});
    FakeXhr.last.onerror?.();
    await expect(promise).rejects.toMatchObject({ message: NETWORK_ERROR, status: 0 });
  });
});
