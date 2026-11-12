import { env } from '../env';

/**
 * Orcamento dos envios (item 117 e revisao de novembro, 2.3). A analise, o ZIP, o .eml, o
 * antivirus e o YARA leem o arquivo inteiro em memoria, entao o que protege a API e limitar
 * quantos bytes estao em memoria ao mesmo tempo.
 *
 * Antes, o envio reservava memoria ao comecar, pelo tamanho declarado, e a segurava enquanto o
 * corpo chegava: tres envios lentos de 200 MB esgotavam o orcamento e todo mundo recebia 503
 * pelo tempo que o cliente quisesse. Agora o corpo vai primeiro para o disco
 * (lib/upload-spool.ts), e a memoria so e reservada depois, pelo tamanho real e pelo tempo da
 * analise. O orcamento de disco limita o que esta chegando, e cada pessoa so ocupa uma parte
 * dele: muitos envios pequenos ao mesmo tempo continuam valendo (o lote de 30 arquivos), mas
 * uma pessoa sozinha nao enche o disco com envios grandes e lentos.
 */
export class UploadGate {
  private used = 0;
  private readonly waiting: { bytes: number; grant: (release: (() => void) | null) => void }[] = [];

  constructor(readonly budget: number) {}

  get inUse(): number {
    return this.used;
  }

  private take(bytes: number): () => void {
    this.used += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= bytes;
      this.drain();
    };
  }

  /** Atende a fila em ordem: quem chegou primeiro nao e ultrapassado por um envio menor. */
  private drain(): void {
    while (this.waiting.length && this.used + this.waiting[0].bytes <= this.budget) {
      const next = this.waiting.shift()!;
      next.grant(this.take(next.bytes));
    }
  }

  /** Reserva `bytes` se couber agora; devolve a funcao que libera (uma vez so). */
  tryAcquire(bytes: number): (() => void) | null {
    if (this.waiting.length || this.used + bytes > this.budget) return null;
    return this.take(bytes);
  }

  /** Reserva `bytes`, esperando a vez por ate `timeoutMs`; null se o tempo acabar. */
  acquire(bytes: number, timeoutMs: number): Promise<(() => void) | null> {
    const now = this.tryAcquire(bytes);
    if (now || timeoutMs <= 0 || bytes > this.budget) return Promise.resolve(now);
    return new Promise((resolve) => {
      const entry = {
        bytes,
        grant: (release: (() => void) | null) => {
          clearTimeout(timer);
          resolve(release);
        },
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(entry);
        if (at >= 0) this.waiting.splice(at, 1);
        resolve(null);
        // Quem saiu da frente pode estar segurando os de tras.
        this.drain();
      }, timeoutMs);
      this.waiting.push(entry);
    });
  }
}

/** Memoria: sempre cabe ao menos um envio do tamanho maximo. */
export const uploadGate = new UploadGate(
  Math.max(env.MAX_UPLOAD_MEMORY_MB, env.MAX_UPLOAD_MB) * 1024 * 1024,
);

/** Disco: o que esta chegando ao mesmo tempo (reservado pelo tamanho declarado). */
export const spoolGate = new UploadGate(
  Math.max(env.MAX_UPLOAD_SPOOL_MB, env.MAX_UPLOAD_MB) * 1024 * 1024,
);

/** Ajustaveis pelos testes. */
export const uploadLimits = {
  /** Espera pela memoria depois de o corpo ja ter chegado inteiro. */
  waitMs: 30_000,
  /** Parte do orcamento de disco que uma pessoa pode ocupar com o que esta chegando. */
  perUserShare: 0.5,
};

const inFlight = new Map<string, number>();

/**
 * Conta os bytes de um envio da pessoa (pelo tamanho declarado); null se, com ele, ela passaria
 * da parte dela no disco. Devolve a funcao que desconta. Um envio sozinho sempre entra.
 */
export function enterUpload(userId: string, bytes: number): (() => void) | null {
  const current = inFlight.get(userId) ?? 0;
  if (current > 0 && current + bytes > spoolGate.budget * uploadLimits.perUserShare) return null;
  inFlight.set(userId, current + bytes);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const rest = (inFlight.get(userId) ?? bytes) - bytes;
    if (rest > 0) inFlight.set(userId, rest);
    else inFlight.delete(userId);
  };
}
