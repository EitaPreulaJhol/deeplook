import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

type Reply = { status?: number; body: unknown };
/** Servidor falso: guarda o ultimo pedido e responde o que o teste mandar. */
function fakeServer() {
  const state = {
    reply: { body: {} } as Reply,
    last: null as null | {
      url: string;
      headers: http.IncomingHttpHeaders;
      body: Record<string, unknown>;
    },
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      state.last = { url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') };
      res.statusCode = state.reply.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(state.reply.body));
    });
  });
  return { server, state };
}

const draft = {
  summary: 'Executável que baixa um segundo estágio e grava na chave Run.',
  findings: '- Sigma: chave Run (alto)\n- Emulação: contata deeplook-c2.top',
  iocs: ['deeplook-c2.top', 'deeplook-c2.top', ' http://deeplook-c2.top/x '],
  verdict: 'MALICIOUS',
  attackTechniques: ['T1547.001', 't1059.001', 'T9999'],
};
const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_teste',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

// Rascunho do relatorio por IA (plans/novas-analises, item 7), contra servidores falsos nos dois
// formatos: a API da Anthropic (pelo SDK, com a saida estruturada e o fallback do servidor) e um
// servidor compativel com /v1/chat/completions (modelo local). Confere o que sai (nunca o arquivo),
// o que volta (tecnicas validadas, IOCs sem repeticao), as falhas legiveis, o limite e a auditoria.
async function main() {
  const fake = fakeServer();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  env.LLM_PROVIDER = '';
  const app = await buildApp();
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  await prisma.user.create({
    data: { email: 'u@x.io', displayName: 'U', role: 'USER', passwordHash },
  });
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const [cAna, cUser] = [await login('ana@x.io'), await login('u@x.io')];
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@x.io' } });
  const entry = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.exe',
      originalFilename: 'fatura.exe',
      ownerId: owner.id,
      sha256: 'a'.repeat(64),
      staticInfo: {
        detectedType: { id: 'pe', label: 'Executável do Windows (PE)' },
        iocCandidates: [{ kind: 'DOMAIN', value: 'deeplook-c2.top' }],
      },
    },
  });
  const ask = (c = cAna, lang?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${entry.id}/reports/ai-draft`,
      headers: { cookie: c, ...(lang && { 'accept-language': lang }) },
    });

  // ---- 1. Desligado.
  ok(
    'desligado: status',
    (await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie: cAna } })).json()
      .enabled === false,
  );
  ok('desligado: pedido recusado', (await ask()).statusCode === 503);

  // ---- 2. Anthropic.
  Object.assign(env, {
    LLM_PROVIDER: 'anthropic',
    LLM_URL: base,
    LLM_API_KEY: 'sk-teste-0123456789',
    LLM_MODEL: '',
    LLM_DAILY_LIMIT: 30,
  });
  const status = (
    await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie: cAna } })
  ).json();
  ok(
    'status: Anthropic, Opus 5.5, para onde vai',
    status.enabled && status.model === 'claude-opus-5-5' && status.destination === base,
    status,
  );
  ok(
    'usuário comum não vê ligado',
    (await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie: cUser } })).json()
      .enabled === false,
  );
  ok('usuário comum não pede', (await ask(cUser)).statusCode === 403);
  fake.state.reply = { body: message(JSON.stringify(draft)) };
  const res = await ask();
  const body = res.json();
  const sent = fake.state.last;
  ok('rascunho volta', res.statusCode === 200 && body.draft?.summary === draft.summary, body);
  ok(
    'técnicas validadas no ATT&CK (a inexistente sai e é avisada)',
    JSON.stringify(body.draft?.attackTechniques) === JSON.stringify(['T1059.001', 'T1547.001']) &&
      JSON.stringify(body.dropped) === JSON.stringify(['T9999']),
    body,
  );
  ok('IOCs sem repetição', body.draft?.iocs?.length === 2, body.draft?.iocs);
  ok(
    'pedido: modelo, saída estruturada, esforço e fallback do servidor',
    sent?.url === '/v1/messages' &&
      sent.body.model === 'claude-opus-5-5' &&
      sent.body.fallbacks === 'default' &&
      String(sent.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') &&
      (sent.body.output_config as { format?: { type?: string }; effort?: string })?.format?.type ===
        'json_schema' &&
      (sent.body.output_config as { effort?: string }).effort === 'medium',
    sent && {
      url: sent.url,
      beta: sent.headers['anthropic-beta'],
      body: { ...sent.body, messages: undefined, system: undefined },
    },
  );
  const userText = JSON.stringify((sent?.body.messages as unknown[]) ?? []);
  ok(
    'evidências vão (o hash e o IOC), sem o arquivo',
    userText.includes('a'.repeat(64)) &&
      userText.includes('deeplook-c2.top') &&
      !userText.includes('storageKey'),
    userText.slice(0, 300),
  );
  ok(
    'a chave vai no cabeçalho, não no corpo',
    // O SDK 1.x manda a chave como Bearer.
    sent?.headers.authorization === 'Bearer sk-teste-0123456789' &&
      !JSON.stringify(sent?.body).includes('sk-teste'),
  );
  const audited = await prisma.auditEvent.findFirst({ where: { action: 'REPORT_AI_DRAFT' } });
  ok(
    'na auditoria, com o destino',
    audited?.detail?.includes('claude-opus-5-5') && audited.detail.includes(base),
    audited?.detail,
  );
  await ask(cAna, 'en');
  ok(
    'em inglês, o pedido diz o idioma',
    String(fake.state.last?.body.system).includes('Write summary and findings in English.'),
  );

  // ---- 3. Falhas legiveis.
  fake.state.reply = { body: message('', 'refusal') };
  const refused = await ask();
  ok(
    'recusa do classificador',
    refused.statusCode === 502 && /recusou/.test(refused.json().error),
    refused.body,
  );
  fake.state.reply = { body: message('isto não é JSON') };
  ok('fora do formato', /fora do formato/.test((await ask()).json().error));
  fake.state.reply = { body: message(JSON.stringify({ ...draft, verdict: 'TALVEZ' })) };
  ok('veredito inválido é fora do formato', (await ask()).statusCode === 502);
  fake.state.reply = {
    status: 401,
    body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
  };
  const denied = await ask(cAna, 'en');
  ok(
    'chave recusada, em inglês',
    denied.json().error ===
      'Could not generate the draft: the provider did not accept the key (LLM_API_KEY)',
    denied.body,
  );

  // ---- 4. Servidor compativel com OpenAI (modelo local), com o JSON numa cerca de codigo.
  Object.assign(env, {
    LLM_PROVIDER: 'openai',
    LLM_URL: `${base}/v1`,
    LLM_API_KEY: '',
    LLM_MODEL: 'qwen-local',
  });
  fake.state.reply = {
    body: {
      choices: [
        { message: { role: 'assistant', content: '```json\n' + JSON.stringify(draft) + '\n```' } },
      ],
    },
  };
  const local = await ask();
  ok(
    'modelo local responde',
    local.statusCode === 200 && local.json().draft?.verdict === 'MALICIOUS',
    local.body,
  );
  ok(
    'pedido local: chat/completions, o modelo e o json_schema',
    fake.state.last?.url === '/v1/chat/completions' &&
      fake.state.last.body.model === 'qwen-local' &&
      (fake.state.last.body.response_format as { type?: string })?.type === 'json_schema' &&
      !fake.state.last.headers.authorization,
    fake.state.last?.url,
  );
  env.LLM_MODEL = '';
  ok('local sem LLM_MODEL fica desligado', (await ask()).statusCode === 503);
  env.LLM_MODEL = 'qwen-local';

  // ---- 5. Limite por analista em 24 h.
  const used = await prisma.auditEvent.count({ where: { action: 'REPORT_AI_DRAFT' } });
  env.LLM_DAILY_LIMIT = used;
  const limited = await ask();
  ok('limite diário', limited.statusCode === 429, limited.body);

  await app.close();
  fake.server.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
