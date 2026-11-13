import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { api, apiFieldErrors } from '../api/client';
import { t as tr } from '../i18n/entry';
import { describeReason, useRelatedEntries } from './EntryRelatedTab';
import { VerdictTag } from './tags';

/** Id da amostra a partir do que foi colado: o proprio id ou um link /entries/<id>. */
function parseEntryId(text: string): string {
  const t = text.trim();
  return t.match(/\/entries\/([\w-]+)/)?.[1] ?? t;
}

interface Props {
  entryId: string;
  /** Ids das duplicatas desta amostra (nao podem ser a principal: seria ciclo). */
  excludeIds: string[];
  /** Fecha; com `principal`, a marcacao foi feita. */
  onClose: (principal?: { id: string; title: string }) => void;
}

/**
 * Caixa "Marcar como duplicata" (registro pai/filho do HPSM): escolhe a amostra
 * principal entre as relacionadas (mais relevantes primeiro) ou por id/link.
 */
export function DuplicateDialog({ entryId, excludeIds, onClose }: Props) {
  return (
    <EntryPickDialog
      entryId={entryId}
      excludeIds={excludeIds}
      title={tr('markDuplicateTitle')}
      message={tr('markDuplicateMsg')}
      legend={tr('mainSampleLegend')}
      otherLabel={tr('mainSampleOther')}
      submitLabel={tr('mark')}
      busyLabel={tr('marking')}
      emptyChoice={tr('mainSampleEmpty')}
      onPick={async (target) => {
        try {
          const res = await api.post<{ principal: { id: string; title: string } }>(
            `/entries/${entryId}/duplicate`,
            { of: target },
          );
          onClose(res.principal);
          return null;
        } catch (err) {
          const details = apiFieldErrors(err);
          return details?.of?.length
            ? tr('mainSampleError', { detail: details.of[0] })
            : (err as Error).message;
        }
      }}
      onClose={() => onClose()}
    />
  );
}

interface PickProps {
  entryId: string;
  excludeIds?: string[];
  title: string;
  message: string;
  legend: string;
  /** aria-label do campo "Outra amostra". */
  otherLabel: string;
  submitLabel: string;
  busyLabel: string;
  emptyChoice: string;
  /** Usa a amostra escolhida; devolve a mensagem de erro (ou null se deu certo). */
  onPick: (target: string) => Promise<string | null>;
  onClose: () => void;
}

/**
 * Escolher outra amostra (duplicata, comparar): sugere as relacionadas (mais
 * relevantes primeiro) ou aceita id/link. Esc ou Cancelar fecham; Tab circula
 * dentro da caixa.
 */
export function EntryPickDialog({
  entryId,
  excludeIds = [],
  title,
  message,
  legend,
  otherLabel,
  submitLabel,
  busyLabel,
  emptyChoice,
  onPick,
  onClose,
}: PickProps) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const related = useRelatedEntries(entryId);
  const candidates = (related.data?.items ?? [])
    .filter((item) => !excludeIds.includes(item.entry.id))
    .slice(0, 8);
  const [choice, setChoice] = useState<string>('');
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Primeira sugestao ja escolhida quando a lista chega; sem sugestoes, "outra".
  useEffect(() => {
    if (choice || !related.data) return;
    setChoice(candidates[0]?.entry.id ?? 'other');
    // So na chegada da lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [related.data]);

  // Foco inicial no primeiro campo; ao fechar, volta para onde estava.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Sugestoes chegaram e ninguem digitou ainda: o foco vai para a primeira.
  useEffect(() => {
    if (!related.data || other) return;
    boxRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
    // So na chegada da lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [related.data]);

  const target = choice === 'other' ? parseEntryId(other) : choice;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) {
      setError(emptyChoice);
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await onPick(target);
    if (failure) {
      setError(failure);
      setSaving(false);
      // O botao desabilitado tirou o foco da caixa: volta para a opcao escolhida.
      const selector = choice === 'other' ? '.hpsm-modal__input' : 'input[type="radio"]:checked';
      requestAnimationFrame(() => boxRef.current?.querySelector<HTMLElement>(selector)?.focus());
    }
  };

  // Esc fecha mesmo se o foco tiver saido da caixa (ex.: durante o envio).
  useEffect(() => {
    const onDocKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !boxRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const focusables = [
        ...(boxRef.current?.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled)',
        ) ?? []),
      ].filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      const next = (index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
      event.preventDefault();
      focusables[next]?.focus();
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        ref={boxRef}
        className="hpsm-modal__box hpsm-modal__box--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {title}
        </h2>
        <form onSubmit={submit}>
          <div className="hpsm-modal__prompt">
            <div className="hpsm-modal__message">{message}</div>
            {error && (
              <div className="dl-dup-error" role="alert">
                {error}
              </div>
            )}
            <fieldset className="dl-dup-options">
              <legend className="hpsm-modal__label">{legend}</legend>
              {related.isLoading && (
                <div className="dl-related-hint">{tr('searchingRelated2')}</div>
              )}
              {candidates.map(({ entry, reasons }) => (
                <label key={entry.id} className="dl-dup-option">
                  <input
                    type="radio"
                    name={`${titleId}-choice`}
                    value={entry.id}
                    checked={choice === entry.id}
                    onChange={() => setChoice(entry.id)}
                  />
                  <span className="dl-dup-option__title">{entry.title}</span>
                  <VerdictTag verdict={entry.verdict} />
                  <span className="dl-dup-option__reason">{describeReason(reasons[0])}</span>
                </label>
              ))}
              <label className="dl-dup-option">
                <input
                  type="radio"
                  name={`${titleId}-choice`}
                  value="other"
                  checked={choice === 'other'}
                  onChange={() => setChoice('other')}
                />
                <span className="dl-dup-option__title">{tr('otherSample')}</span>
              </label>
              <input
                className="hpsm-modal__input"
                aria-label={otherLabel}
                placeholder={tr('otherSamplePlaceholder')}
                value={other}
                onFocus={() => setChoice('other')}
                onChange={(e) => {
                  setOther(e.target.value);
                  setChoice('other');
                }}
              />
            </fieldset>
          </div>
          <div className="hpsm-modal__actions">
            <button type="submit" className="dl-btn dl-btn--primary" disabled={saving || !target}>
              {saving ? busyLabel : submitLabel}
            </button>
            <button type="button" className="dl-btn" onClick={() => onClose()}>
              {tr('cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
