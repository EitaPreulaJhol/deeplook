import { useEffect, useState } from 'react';

import { IconCopy } from './icons';

/** Copia o texto; sem a Clipboard API (HTTP sem TLS), usa o metodo antigo. */
/** Copia para a area de transferencia (com o metodo antigo como reserva). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cai no metodo antigo */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

interface CopyButtonProps {
  /** Texto copiado. */
  value: string;
  /** O que esta sendo copiado (ex.: "SHA-256"), para o rotulo acessivel. */
  label: string;
}

/** Botao de copiar (icone 16px); confirma "Copiado" no proprio botao. */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const id = window.setTimeout(() => setState('idle'), 1800);
    return () => window.clearTimeout(id);
  }, [state]);

  return (
    <button
      type="button"
      className={`hpsm-copy${state !== 'idle' ? ` is-${state}` : ''}`}
      title={`Copiar ${label}`}
      aria-label={`Copiar ${label}`}
      onClick={async () => setState((await copyText(value)) ? 'copied' : 'failed')}
    >
      <IconCopy size={16} />
      <span className="hpsm-copy__status" aria-live="polite">
        {state === 'copied' ? 'Copiado' : state === 'failed' ? 'Não foi possível copiar' : ''}
      </span>
    </button>
  );
}
