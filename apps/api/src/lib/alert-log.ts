import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { env } from '../env';
import { log } from './log';

/**
 * Log centralizado de alertas (plano pos-revisao, item 5.2): com `ALERT_LOG` (o caminho de um
 * arquivo), uma linha JSON por alerta, para um coletor (Filebeat, Fluent Bit, rsyslog, Wazuh) levar
 * ao SIEM. Sem a variavel, nada e gravado.
 *
 * O arquivo e aberto em modo de acrescimo a cada linha: a rotacao externa (logrotate, com
 * `copytruncate` ou `create`) funciona sem reiniciar a API. Falha ao gravar so vai para o log da
 * API: quem chamou nunca cai por causa do alerta.
 */

export type AlertLevel = 'warn' | 'error' | 'info';

/** Codigos estaveis, para filtrar no coletor. */
export type AlertCode =
  | 'backup.failed'
  | 'status.down'
  | 'status.recovered'
  | 'audit.chain_broken'
  | 'audit.chain_ok'
  | 'integrity.mismatch'
  | 'yara.update_held';

export interface AlertLine {
  time: string;
  level: AlertLevel;
  code: AlertCode;
  message: string;
  context: Record<string, unknown>;
}

/** Ultimo estado de cada assunto (ex.: um componente): o mesmo estado nao vira outra linha. */
const lastState = new Map<string, string>();

export const alertLogEnabled = (): boolean => Boolean(env.ALERT_LOG);

/** Grava o alerta. Nunca lanca. */
export async function writeAlert(
  level: AlertLevel,
  code: AlertCode,
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (!env.ALERT_LOG) return;
  const line: AlertLine = { time: new Date().toISOString(), level, code, message, context };
  try {
    await mkdir(dirname(env.ALERT_LOG), { recursive: true });
    await appendFile(env.ALERT_LOG, `${JSON.stringify(line)}\n`, { encoding: 'utf8', mode: 0o640 });
  } catch (err) {
    log.error({ err, code }, '[alertas] falha ao gravar no log de alertas');
  }
}

/**
 * Alerta de mudanca de estado: so grava quando o estado do assunto muda (cair e voltar sao duas
 * linhas, nao uma por conferencia). O primeiro estado "normal" depois da subida nao e alerta.
 */
export async function writeStateAlert(
  subject: string,
  state: string,
  normal: boolean,
  alert: () => Parameters<typeof writeAlert>,
): Promise<void> {
  const previous = lastState.get(subject);
  lastState.set(subject, state);
  if (previous === state) return;
  if (previous === undefined && normal) return;
  await writeAlert(...alert());
}

/** Para os testes: esquece os estados. */
export function resetAlertState(): void {
  lastState.clear();
}
