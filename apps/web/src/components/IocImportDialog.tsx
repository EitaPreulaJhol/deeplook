import { TextArea, TextInput } from '@carbon/react';
import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';
import type { IocKind } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/detection';
import { IOC_KIND_LABELS } from './iocs';

type Target = 'watch' | 'allow';
type Status = 'new' | 'exists' | 'covered' | 'limit';

interface Preview {
  format: 'csv' | 'stix';
  items: { kind: IocKind; value: string; where: string; status: Status }[];
  invalid: { where: string; text: string; reason: string }[];
  repeated: number;
  counts: Record<Status, number>;
  room: number | null;
}

/** Linhas mostradas por tabela (o resto vira "+N"). */
const SHOWN = 200;
const MAX_BYTES = 2 * 1024 * 1024;

const STATUS: Record<Target, Record<Status, string>> = localized(() => ({
  watch: { new: t('stNew'), exists: t('stFollowing'), covered: '—', limit: t('stNoRoom') },
  allow: {
    new: t('stNew'),
    exists: t('stAllowed'),
    covered: t('stCovered'),
    limit: '—',
  },
}));

/**
 * Importar indicadores (item 78) em CSV/lista ou STIX 2.1: cola ou escolhe o
 * arquivo, pre-visualiza o que foi reconhecido (novos, ja existentes e
 * invalidos com o motivo) e confirma. Esc ou Cancelar fecham.
 */
export function IocImportDialog({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    textRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Esc no documento: um botao desabilitado durante a leitura perde o foco.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t('fileTooLarge2mb'));
      return;
    }
    setText(await file.text());
    setPreview(null);
  };

  const runPreview = async () => {
    setError(null);
    setBusy(true);
    try {
      setPreview(await api.post<Preview>('/iocs/import/preview', { target, text }));
    } catch (err) {
      setError((err as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const fresh = preview?.items.filter((i) => i.status === 'new') ?? [];
  const runImport = async () => {
    setError(null);
    if (target === 'allow' && reason.trim().length < 3) {
      setError(t('reasonRequired'));
      document.getElementById('import-reason')?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ added: number }>('/iocs/import', {
        target,
        items: fresh.map(({ kind, value }) => ({ kind, value })),
        ...(target === 'allow' ? { reason } : {}),
      });
      onDone(
        target === 'watch'
          ? t('watchedAdded', { n: res.added })
          : t('allowAdded', { n: res.added }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = target === 'watch' ? t('importWatchTitle') : t('importAllowTitle');
  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box dl-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {title}
        </h2>
        <div className="dl-import__body">
          <p className="dl-import__hint">
            {t('importHint1')} <strong>STIX 2.1</strong> {t('importHint2')}
            {target === 'watch' && ` ${t('importHintWatch')}`}
          </p>
          <TextArea
            id="import-text"
            ref={textRef}
            labelText={t('listOrStix')}
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
          />
          <div className="dl-import__row">
            <input
              ref={fileRef}
              id="import-file"
              type="file"
              accept=".csv,.txt,.json,text/csv,text/plain,application/json"
              hidden
              onChange={(e) => void loadFile(e.target.files?.[0])}
            />
            <button type="button" className="dl-btn" onClick={() => fileRef.current?.click()}>
              {t('chooseFile')}
            </button>
            <button
              type="button"
              className="dl-btn dl-btn--primary"
              disabled={busy || !text.trim()}
              onClick={() => void runPreview()}
            >
              {busy && !preview ? t('reading') : t('preview')}
            </button>
          </div>

          {error && (
            <p className="dl-import__error" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <div className="dl-import__preview" aria-live="polite">
              <p className="dl-import__summary">
                {preview.format === 'stix' ? t('stixPackage') : t('list')}:{' '}
                <strong>{t('newN', { n: preview.counts.new })}</strong>
                {preview.counts.exists > 0 &&
                  `, ${t(target === 'watch' ? 'alreadyFollowedN' : 'alreadyAllowedN', { n: preview.counts.exists })}`}
                {preview.counts.covered > 0 && `, ${t('coveredN', { n: preview.counts.covered })}`}
                {preview.counts.limit > 0 && `, ${t('noRoomN', { n: preview.counts.limit })}`}
                {preview.invalid.length > 0 && `, ${t('invalidN', { n: preview.invalid.length })}`}
                {preview.repeated > 0 && `, ${t('repeatedN', { n: preview.repeated })}`}.
                {preview.room !== null && ` ${t('roomLeft', { n: preview.room })}`}
              </p>
              {preview.items.length > 0 && (
                <table className="dl-import__table" aria-label={t('recognizedAria')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('type')}</th>
                      <th scope="col">{t('indicator')}</th>
                      <th scope="col">{t('where')}</th>
                      <th scope="col">{t('situation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, SHOWN).map((i) => (
                      <tr key={`${i.kind}:${i.value}`} className={`is-${i.status}`}>
                        <td>{IOC_KIND_LABELS[i.kind]}</td>
                        <td className="dl-mono">{i.value}</td>
                        <td>{i.where}</td>
                        <td>{STATUS[target][i.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.items.length > SHOWN && (
                <p className="dl-hint-muted">
                  {t('moreRecognized', { n: preview.items.length - SHOWN })}
                </p>
              )}
              {preview.invalid.length > 0 && (
                <>
                  <h3 className="dl-import__subhead">{t('notImported')}</h3>
                  <table className="dl-import__table" aria-label={t('notImportedAria')}>
                    <thead>
                      <tr>
                        <th scope="col">{t('where')}</th>
                        <th scope="col">{t('text')}</th>
                        <th scope="col">{t('reason')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.invalid.slice(0, SHOWN).map((i, n) => (
                        <tr key={n}>
                          <td>{i.where}</td>
                          <td className="dl-mono">{i.text}</td>
                          <td>{i.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.invalid.length > SHOWN && (
                    <p className="dl-hint-muted">
                      {t('moreNotImported', { n: preview.invalid.length - SHOWN })}
                    </p>
                  )}
                </>
              )}
              {target === 'allow' && fresh.length > 0 && (
                <TextInput
                  id="import-reason"
                  labelText={t('reasonForAll')}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        <div className="hpsm-modal__actions">
          <button
            type="button"
            className="dl-btn dl-btn--primary"
            disabled={busy || fresh.length === 0}
            onClick={() => void runImport()}
          >
            {busy && preview ? t('importing') : t('importN', { n: fresh.length })}
          </button>
          <button type="button" className="dl-btn" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
