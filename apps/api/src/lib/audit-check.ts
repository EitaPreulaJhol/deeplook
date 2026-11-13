import { writeStateAlert } from './alert-log';
import { type AuditChainState, chainAuditHistory, verifyAuditChain } from './audit';

/**
 * Conferencia periodica da cadeia da auditoria (revisao de novembro, item 1.3). Na subida,
 * encadeia o historico que ainda estiver de fora; depois, de hora em hora, percorre a cadeia. O
 * resultado fica na memoria para o status do sistema, e a ponta vai para o log: e uma ancora de
 * fora do banco, contra a qual a cadeia pode ser conferida depois.
 */

const EVERY_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30_000;

type Logger = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

let last: AuditChainState | null = null;
/** A maior ponta ja vista por este processo: a cadeia nao pode encolher nem mudar abaixo dela. */
let known: { seq: number; hash: string } | null = null;

/** O resultado da ultima conferencia (null antes da primeira). */
export function lastAuditCheck(): AuditChainState | null {
  return last;
}

/** Confere agora, contra a maior ponta ja vista, e guarda o resultado. */
export async function checkAuditChain(): Promise<AuditChainState> {
  const state = await verifyAuditChain({ expect: known });
  if (state.ok && state.head) known = state.head;
  last = state;
  return state;
}

/** Para os testes: esquece o que este processo ja viu. */
export function resetAuditCheck(): void {
  last = null;
  known = null;
}

export function startAuditCheck(log: Logger): void {
  const run = async () => {
    try {
      const chained = await chainAuditHistory();
      if (chained) log.info({ chained }, '[auditoria] histórico encadeado');
      const state = await checkAuditChain();
      if (state.ok) {
        log.info(
          { events: state.events, head: state.head },
          '[auditoria] cadeia íntegra (anote a ponta: ela confere a cadeia depois)',
        );
      } else {
        log.error({ problem: state.problem, head: state.head }, '[auditoria] CADEIA QUEBRADA');
      }
      // Log de alertas (plano pos-revisao, 5.2): ao quebrar e ao voltar a conferir.
      await writeStateAlert('audit-chain', state.ok ? 'ok' : 'broken', state.ok, () =>
        state.ok
          ? ['info', 'audit.chain_ok', 'Cadeia da auditoria íntegra de novo', { head: state.head }]
          : [
              'error',
              'audit.chain_broken',
              'Cadeia da auditoria quebrada',
              { problem: state.problem, head: state.head },
            ],
      );
    } catch (err) {
      log.error({ err }, '[auditoria] falha na conferência da cadeia');
    }
  };
  setTimeout(() => void run(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void run(), EVERY_MS).unref();
}
