import { env } from '../env';

/**
 * Orcamento de memoria dos envios (item 117). A analise, o ZIP, o .eml, o antivirus
 * e o YARA leem o arquivo inteiro em memoria, entao gravar em disco antes nao
 * ajudaria: o que protege a API e limitar quantos bytes entram ao mesmo tempo.
 */
export class UploadGate {
  private used = 0;

  constructor(readonly budget: number) {}

  get inUse(): number {
    return this.used;
  }

  /** Reserva `bytes` se couber; devolve a funcao que libera (uma vez so). */
  tryAcquire(bytes: number): (() => void) | null {
    if (this.used + bytes > this.budget) return null;
    this.used += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= bytes;
    };
  }
}

/** Sempre cabe ao menos um envio do tamanho maximo. */
export const uploadGate = new UploadGate(
  Math.max(env.MAX_UPLOAD_MEMORY_MB, env.MAX_UPLOAD_MB) * 1024 * 1024,
);
