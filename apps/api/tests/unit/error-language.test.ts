import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import {
  registerErrorLanguage,
  requestLang,
  translateErrorBody,
  translateMessage,
} from '../../src/lib/error-language';
import { MESSAGES_EN } from '../../src/lib/messages-en';

test('idioma do pedido: só "en" no começo do Accept-Language vira inglês', () => {
  assert.equal(requestLang({ headers: {} }), 'pt-BR');
  assert.equal(requestLang({ headers: { 'accept-language': 'en' } }), 'en');
  assert.equal(requestLang({ headers: { 'accept-language': 'en-US,en;q=0.9' } }), 'en');
  assert.equal(requestLang({ headers: { 'accept-language': 'pt-BR,en;q=0.5' } }), 'pt-BR');
  assert.equal(requestLang({ headers: { 'accept-language': '*' } }), 'pt-BR');
});

test('mensagens: exata, com trechos variáveis e com um erro dentro de outro', () => {
  assert.equal(translateMessage('Amostra não encontrada.'), 'Sample not found.');
  assert.equal(
    translateMessage('Arquivo maior que o limite de 100 MB.'),
    'File larger than the 100 MB limit.',
  );
  assert.equal(
    translateMessage('Muitas tentativas. Tente novamente em 3 minutos.'),
    'Too many attempts. Try again in 3 minutes.',
  );
  assert.equal(translateMessage('mínimo de 3 caracteres'), 'at least 3 characters');
  // O motivo (outra mensagem conhecida) tambem e traduzido.
  assert.equal(
    translateMessage('Não foi possível concluir: Senha incorreta para o .zip.'),
    'Could not finish: Wrong password for the .zip.',
  );
  assert.equal(
    translateMessage('texto que não está no dicionário'),
    'texto que não está no dicionário',
  );
});

test('corpo de erro: error e details por campo', () => {
  const body = translateErrorBody({
    error: 'Dados inválidos.',
    details: { title: ['mínimo de 3 caracteres'], url: ['URL inválida'] },
    extra: 1,
  });
  assert.deepEqual(body, {
    error: 'Invalid data.',
    details: { title: ['at least 3 characters'], url: ['invalid URL'] },
    extra: 1,
  });
});

test('dicionário: chaves únicas, os mesmos {n} nos dois lados', () => {
  const seen = new Set<string>();
  for (const [pt, en] of MESSAGES_EN) {
    assert.ok(!seen.has(pt), `repetida: ${pt}`);
    seen.add(pt);
    assert.ok(en.trim(), pt);
    const slots = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
    assert.equal(slots(en), slots(pt), pt);
  }
  assert.ok(MESSAGES_EN.length > 300);
});

test('gancho: traduz só erro em JSON de quem pediu inglês', async () => {
  const app = Fastify();
  registerErrorLanguage(app);
  app.get('/missing', async (_req, reply) =>
    reply.code(404).send({ error: 'Amostra não encontrada.' }),
  );
  app.get('/ok', async () => ({ note: 'Amostra não encontrada.' }));
  app.get('/text', async (_req, reply) =>
    reply.code(400).type('text/plain').send('Amostra não encontrada.'),
  );
  const en = { 'accept-language': 'en' };
  assert.equal(
    (await app.inject({ url: '/missing', headers: en })).json().error,
    'Sample not found.',
  );
  assert.equal((await app.inject({ url: '/missing' })).json().error, 'Amostra não encontrada.');
  assert.equal(
    (await app.inject({ url: '/ok', headers: en })).json().note,
    'Amostra não encontrada.',
  );
  assert.equal((await app.inject({ url: '/text', headers: en })).body, 'Amostra não encontrada.');
  await app.close();
});

test('mensagem do Proxmox: detalhe do PVE com ponto e a dica de permissão no fim', () => {
  const pt =
    'Proxmox respondeu HTTP 403 em POST /nodes/pve/qemu/9000/clone ' +
    '(Permission check failed (/vms/9000, VM.Clone)). Permissões: ' +
    'Ler a task exige que ela seja sua ou Sys.Audit no node.';
  assert.equal(
    translateMessage(pt),
    'Proxmox answered HTTP 403 on POST /nodes/pve/qemu/9000/clone ' +
      '(Permission check failed (/vms/9000, VM.Clone)). Permissions: ' +
      'Reading the task requires it to be yours or Sys.Audit on the node.',
  );
  assert.equal(
    translateMessage('Proxmox respondeu HTTP 500 em GET /version.'),
    'Proxmox answered HTTP 500 on GET /version.',
  );
});

test('idioma pela URL (?lang=): vale sobre o cabeçalho, para links de download', () => {
  assert.equal(
    requestLang({ headers: { 'accept-language': 'pt-BR' }, query: { lang: 'en' } }),
    'en',
  );
  assert.equal(
    requestLang({ headers: { 'accept-language': 'en' }, query: { lang: 'pt-BR' } }),
    'pt-BR',
  );
  assert.equal(requestLang({ headers: { 'accept-language': 'en' }, query: { lang: 'xx' } }), 'en');
  assert.equal(requestLang({ headers: {}, query: {} }), 'pt-BR');
});
