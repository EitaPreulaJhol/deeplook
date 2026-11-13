import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { api, apiFieldErrors } from '../api/client';
import { t } from '../i18n/entry';
import type { CaseSummary } from './cases';
import { CASE_STATUS } from './cases';

/**
 * Caixa "Adicionar a caso" (item 55): inclui as amostras num caso ativo ou cria
 * um caso novo com elas. Usada na ficha (uma amostra) e na lista (as marcadas).
 * Esc ou Cancelar fecham; Tab circula dentro da caixa.
 */
export function AddToCaseDialog({
  entryIds,
  defaultTitle = '',
  onClose,
}: {
  entryIds: string[];
  /** Titulo sugerido para um caso novo. */
  defaultTitle?: string;
  /** Fecha; com `result`, as amostras foram incluidas. */
  onClose: (result?: { id: string; code: string; created: boolean }) => void;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState<string>('new');
  const [title, setTitle] = useState(defaultTitle);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ['cases', 'active', search],
    queryFn: () =>
      api.get<{ items: CaseSummary[] }>(
        `/cases?status=active&limit=8${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });
  const cases = query.data?.items ?? [];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const many = entryIds.length > 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (choice === 'new' && title.trim().length < 3) {
      setError(t('caseTitleMin'));
      return;
    }
    setSaving(true);
    try {
      let result: { id: string; code: string; created: boolean };
      if (choice === 'new') {
        const res = await api.post<{ case: CaseSummary }>('/cases', { title, entryIds });
        result = { id: res.case.id, code: res.case.code, created: true };
      } else {
        await api.post(`/cases/${choice}/entries`, { entryIds });
        const c = cases.find((x) => x.id === choice);
        result = { id: choice, code: c?.code ?? '', created: false };
      }
      await queryClient.invalidateQueries({ queryKey: ['cases'] });
      await queryClient.invalidateQueries({ queryKey: ['entry-cases'] });
      onClose(result);
    } catch (err) {
      const details = apiFieldErrors(err);
      setError(
        details?.title?.[0]
          ? t('titleError', { detail: details.title[0] })
          : (err as Error).message,
      );
      setSaving(false);
    }
  };

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
          {t('addToCaseTitle')}
        </h2>
        <form onSubmit={submit}>
          <div className="hpsm-modal__prompt">
            <div className="hpsm-modal__message">
              {many ? t('addToCaseMsgMany', { n: entryIds.length }) : t('addToCaseMsgOne')}
            </div>
            {error && (
              <div className="dl-dup-error" role="alert">
                {error}
              </div>
            )}
            <fieldset className="dl-dup-options">
              <legend className="hpsm-modal__label">{t('caseLabel')}</legend>
              <label className="dl-dup-option">
                <input
                  type="radio"
                  name={`${titleId}-case`}
                  value="new"
                  checked={choice === 'new'}
                  onChange={() => setChoice('new')}
                />
                <span className="dl-dup-option__title">{t('newCaseLabel')}</span>
              </label>
              <input
                className="hpsm-modal__input"
                aria-label={t('newCaseTitleAria')}
                placeholder={t('newCasePlaceholder')}
                maxLength={150}
                value={title}
                onFocus={() => setChoice('new')}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setChoice('new');
                }}
              />
              <input
                className="hpsm-modal__input dl-case-search"
                aria-label={t('searchActiveCase')}
                placeholder={t('searchActiveCasePlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {query.isLoading && <div className="dl-related-hint">{t('loadingCases')}</div>}
              {query.data && cases.length === 0 && (
                <div className="dl-related-hint">
                  {t(search ? 'noActiveCaseFound' : 'noActiveCase')}
                </div>
              )}
              {cases.map((c) => (
                <label key={c.id} className="dl-dup-option">
                  <input
                    type="radio"
                    name={`${titleId}-case`}
                    value={c.id}
                    checked={choice === c.id}
                    onChange={() => setChoice(c.id)}
                  />
                  <span className="dl-dup-option__title">
                    {c.code} · {c.title}
                  </span>
                  <span className="dl-dup-option__reason">
                    {CASE_STATUS[c.status].label} ·{' '}
                    {t(c.entries === 1 ? 'oneSample' : 'nSamples', { n: c.entries })}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <div className="hpsm-modal__actions">
            <button type="submit" className="dl-btn dl-btn--primary" disabled={saving}>
              {saving ? t('saving') : choice === 'new' ? t('createCase') : t('addToCaseBtn')}
            </button>
            <button type="button" className="dl-btn" onClick={() => onClose()}>
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
