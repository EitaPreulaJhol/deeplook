import type { ServiceKind } from '../generated/prisma/client';
import { readSetting, writeSetting } from './settings';

/**
 * Controle das filas de analise pelo Monitoramento (plans/monitoramento, itens 3 e 4): pausar uma
 * fila (o laco deixa de pegar trabalho novo; o que esta em andamento termina) e interromper o
 * trabalho em andamento (o pedido ao servico e abortado e o trabalho falha com o motivo).
 *
 * A API roda numa instancia so, como os lacos das filas: o registro dos trabalhos em andamento fica
 * em memoria. A pausa fica na configuracao "workersPaused", para sobreviver ao reinicio.
 */

/** As filas que o Monitoramento mostra e controla, na ordem da tela. */
export const QUEUE_IDS = [
  'capa',
  'ghidra',
  'unpack',
  'oletools',
  'qr',
  'emulation',
  'android',
  'config',
  'dotnet',
  'jar',
  'jsdeob',
  'metadata',
  'pydec',
  'ember',
  'suricata',
  'memdump',
] as const;
export type QueueId = (typeof QUEUE_IDS)[number];

const SERVICE_QUEUES: Record<ServiceKind, QueueId> = {
  EMULATION: 'emulation',
  ANDROID: 'android',
  CONFIG: 'config',
  DOTNET: 'dotnet',
  JAR: 'jar',
  JSDEOB: 'jsdeob',
  METADATA: 'metadata',
  PYDEC: 'pydec',
  EMBER: 'ember',
};
/** A fila de um tipo de analise de servico (emulacao, Android, configuracao, .NET, Java). */
export const serviceQueue = (kind: ServiceKind): QueueId => SERVICE_QUEUES[kind];

export const isQueueId = (value: string): value is QueueId =>
  (QUEUE_IDS as readonly string[]).includes(value);

/** Motivo gravado no trabalho cancelado (pendente ou em andamento). */
export const CANCELLED_REASON = 'cancelado pela administração';

const PAUSED_SETTING = 'workersPaused';
let paused = new Set<QueueId>();

/** A fila esta pausada: o laco nao pega trabalho novo. */
export const isQueuePaused = (queue: QueueId): boolean => paused.has(queue);

export const pausedQueues = (): QueueId[] => QUEUE_IDS.filter((q) => paused.has(q));

/** Le a pausa guardada (na subida da API, antes dos lacos). */
export async function loadPausedQueues(): Promise<void> {
  const stored = (await readSetting(PAUSED_SETTING)) as Partial<Record<string, boolean>> | null;
  paused = new Set(QUEUE_IDS.filter((q) => stored?.[q] === true));
}

const wakers = new Map<QueueId, () => void>();

/** Cada fila registra como acordar o laco (ao subir): retomar e refazer nao esperam o tique. */
export function registerQueueWaker(queue: QueueId, wake: () => void): void {
  wakers.set(queue, wake);
}

/** Acorda o laco da fila, se ela ja subiu nesta API. */
export function wakeQueue(queue: QueueId): void {
  wakers.get(queue)?.();
}

/** Pausa ou retoma a fila; devolve se mudou. Retomar acorda o laco. */
export async function setQueuePaused(queue: QueueId, on: boolean): Promise<boolean> {
  if (paused.has(queue) === on) return false;
  if (on) paused.add(queue);
  else paused.delete(queue);
  await writeSetting(
    PAUSED_SETTING,
    Object.fromEntries(QUEUE_IDS.filter((q) => paused.has(q)).map((q) => [q, true])),
  );
  if (!on) wakeQueue(queue);
  return true;
}

/** Para os testes: nenhuma fila pausada. */
export function resetQueueControlForTests(): void {
  paused = new Set();
  running.clear();
}

const running = new Map<string, AbortController>();
const key = (queue: QueueId, id: string) => `${queue}:${id}`;

export interface RunningJob {
  signal: AbortSignal;
  /** O trabalho foi interrompido pela administracao. */
  cancelled(): boolean;
  /** Fim do trabalho (com ou sem erro): sai do registro. */
  done(): void;
}

/** Registra o trabalho que o laco acabou de pegar, com o sinal para interromper o pedido. */
export function startJob(queue: QueueId, id: string): RunningJob {
  const controller = new AbortController();
  running.set(key(queue, id), controller);
  return {
    signal: controller.signal,
    cancelled: () => controller.signal.aborted,
    done: () => {
      if (running.get(key(queue, id)) === controller) running.delete(key(queue, id));
    },
  };
}

/** Interrompe o trabalho em andamento; false se ele nao esta rodando nesta API. */
export function abortJob(queue: QueueId, id: string): boolean {
  const controller = running.get(key(queue, id));
  if (!controller) return false;
  controller.abort(new Error(CANCELLED_REASON));
  return true;
}

/** Os trabalhos que estao rodando agora nesta API (ids por fila). */
export function runningJobIds(queue: QueueId): string[] {
  const prefix = `${queue}:`;
  return [...running.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}
