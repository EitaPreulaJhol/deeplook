import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadSecretFiles, SecretFileError } from '../../src/secret-files';

// Segredos por arquivo (plano pos-revisao, item 5.1): NOME_FILE poe o conteudo do arquivo em NOME.
const dir = mkdtempSync(join(tmpdir(), 'dl-secret-'));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

test('NOME_FILE: lê o arquivo, sem a quebra de linha do fim', () => {
  const env: NodeJS.ProcessEnv = {
    SESSION_SECRET_FILE: file('session', 'segredo-do-arquivo\n'),
    CAPA_TOKEN_FILE: file('capa', 'token-windows\r\n'),
  };
  assert.deepEqual(loadSecretFiles(env).sort(), ['CAPA_TOKEN', 'SESSION_SECRET']);
  assert.equal(env.SESSION_SECRET, 'segredo-do-arquivo');
  assert.equal(env.CAPA_TOKEN, 'token-windows');
});

test('com os dois definidos, vale o arquivo (o compose sempre preenche NOME)', () => {
  const env: NodeJS.ProcessEnv = {
    DATA_KEY: 'valor-padrao-do-compose',
    DATA_KEY_FILE: file('data-key', 'chave-do-arquivo'),
  };
  loadSecretFiles(env);
  assert.equal(env.DATA_KEY, 'chave-do-arquivo');
});

test('sem NOME_FILE, nada muda; nome fora da lista é ignorado', () => {
  const env: NodeJS.ProcessEnv = { SESSION_SECRET: 'do-ambiente', PORT_FILE: file('port', '9999') };
  assert.deepEqual(loadSecretFiles(env), []);
  assert.equal(env.SESSION_SECRET, 'do-ambiente');
  assert.equal(env.PORT, undefined);
});

test('arquivo que não existe ou vazio: erro claro, com o nome', () => {
  assert.throws(
    () => loadSecretFiles({ SESSION_SECRET_FILE: join(dir, 'nao-existe') }),
    (err: unknown) =>
      err instanceof SecretFileError && /SESSION_SECRET_FILE.*ENOENT/.test(err.message),
  );
  assert.throws(
    () => loadSecretFiles({ PROXMOX_PASSWORD_FILE: file('vazio', '\n') }),
    (err: unknown) => err instanceof SecretFileError && /vazio/.test(err.message),
  );
});
