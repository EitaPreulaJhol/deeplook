import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { env } from '../../src/env';
import { resetAlertState, writeAlert, writeStateAlert } from '../../src/lib/alert-log';

// Log centralizado de alertas (plano pos-revisao, item 5.2).
const dir = mkdtempSync(join(tmpdir(), 'dl-alerts-'));
const lines = (path: string) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (l) => JSON.parse(l) as { level: string; code: string; message: string; context: object },
        )
    : [];

test('desligado (ALERT_LOG vazio): nada é gravado', async () => {
  env.ALERT_LOG = '';
  await writeAlert('error', 'backup.failed', 'Falha ao gerar o backup');
  assert.equal(existsSync(join(dir, 'nada.jsonl')), false);
});

test('uma linha JSON por alerta, criando a pasta', async () => {
  env.ALERT_LOG = join(dir, 'sub', 'alertas.jsonl');
  await writeAlert('error', 'backup.failed', 'Falha ao gerar o backup', { backupId: 'b1' });
  await writeAlert('warn', 'yara.update_held', 'Atualização de regras YARA retida');
  const got = lines(env.ALERT_LOG);
  assert.equal(got.length, 2);
  assert.deepEqual(
    { level: got[0].level, code: got[0].code, context: got[0].context },
    { level: 'error', code: 'backup.failed', context: { backupId: 'b1' } },
  );
  assert.ok(!Number.isNaN(Date.parse((got[0] as unknown as { time: string }).time)));
});

test('mudança de estado: grava ao cair e ao voltar, não a cada conferência', async () => {
  env.ALERT_LOG = join(dir, 'estado.jsonl');
  resetAlertState();
  const down = () =>
    ['error', 'status.down', 'Banco de dados: fora', { component: 'database' }] as const;
  const up = () =>
    [
      'info',
      'status.recovered',
      'Banco de dados voltou ao normal',
      { component: 'database' },
    ] as const;
  await writeStateAlert('status:database', 'up', true, () => [...up()]); // subida: normal, sem linha
  await writeStateAlert('status:database', 'down', false, () => [...down()]);
  await writeStateAlert('status:database', 'down', false, () => [...down()]); // repetido
  await writeStateAlert('status:database', 'up', true, () => [...up()]);
  await writeStateAlert('status:storage', 'down', false, () => [...down()]); // ja nasce fora
  assert.deepEqual(
    lines(env.ALERT_LOG).map((l) => l.code),
    ['status.down', 'status.recovered', 'status.down'],
  );
});

test('caminho sem permissão: não lança (quem chamou segue)', async () => {
  env.ALERT_LOG = '/proc/nao-da/alertas.jsonl';
  await assert.doesNotReject(writeAlert('error', 'backup.failed', 'Falha ao gerar o backup'));
  env.ALERT_LOG = '';
});
