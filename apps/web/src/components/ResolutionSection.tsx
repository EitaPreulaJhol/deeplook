import { Select, SelectItem, TextArea } from '@carbon/react';
import { useEffect, useState } from 'react';

import type { EntryStatus, Verdict } from '../api/types';
import { localized } from '../i18n';
import { t as tr } from '../i18n/entry';
import { HpsmField, HpsmForm, HpsmFormActions, HpsmSection } from './HpsmForm';
import { useUnsavedChanges } from './useUnsavedChanges';

/** Mesmo limite da API (routes/entries.ts). */
export const RESOLUTION_MAX = 500;

/** Modelos para quem enviou: o que fazer, sem detalhes tecnicos. */
export const RESOLUTION_TEMPLATES = localized(() => [
  tr('tplScam'),
  tr('tplClicked'),
  tr('tplOpened'),
  tr('tplStillSuspicious'),
  tr('tplSafe'),
  tr('tplUnneeded'),
]);

const TONE: Record<Verdict, string> = {
  MALICIOUS: 'danger',
  SUSPICIOUS: 'warning',
  CLEAN: 'ok',
  UNKNOWN: 'info',
};

/**
 * Resolucao para quem enviou (item 87) em destaque no topo da ficha, para
 * todos: o que fazer com a amostra, em texto puro.
 */
export function ResolutionNotice({
  resolution,
  verdict,
}: {
  resolution: string | null | undefined;
  verdict: Verdict;
}) {
  if (!resolution) return null;
  return (
    <div className={`dl-resolution dl-resolution--${TONE[verdict]}`} role="note">
      <span className="dl-resolution__title">{tr('whatToDoTitle')}</span>
      <span className="dl-resolution__text">{resolution}</span>
    </div>
  );
}

/**
 * Situacao em linguagem simples para o usuario comum (item 137). Com resolucao
 * escrita, quem orienta e ela.
 */
export function EntryStatusNotice({
  type,
  status,
  verdict,
  resolution,
  isOwner,
}: {
  type: 'FILE' | 'URL';
  status: EntryStatus;
  verdict: Verdict;
  resolution: string | null | undefined;
  isOwner: boolean;
}) {
  if (resolution) return null;
  const dontOpen = type === 'FILE' ? tr('dontOpenFile') : tr('dontClickLink');
  let text: string;
  if (status !== 'COMPLETED') {
    const stage = status === 'PENDING' ? tr('stageReceived') : tr('stageAnalyzing');
    text = tr('meanwhile', { stage, dontOpen }) + (isOwner ? ` ${tr('willNotify')}` : '');
  } else if (verdict === 'MALICIOUS') {
    text = tr('doneDangerous', { dontOpen });
  } else if (verdict === 'SUSPICIOUS') {
    text = tr('doneSuspicious', { dontOpen });
  } else if (verdict === 'CLEAN') {
    text = tr('doneClean');
  } else {
    text = tr('doneUnknown', { dontOpen });
  }
  return (
    <div
      className={`dl-resolution dl-resolution--${status === 'COMPLETED' ? TONE[verdict] : 'info'}`}
      role="note"
    >
      <span className="dl-resolution__title">{tr('situation')}</span>
      <span className="dl-resolution__text">{text}</span>
    </div>
  );
}

/**
 * Campo da triagem (analistas): resolucao com modelos que se somam ao texto.
 * Grava no botao (texto livre nao combina com gravar a cada tecla).
 */
export function ResolutionForm({
  resolution,
  onSave,
}: {
  resolution: string | null | undefined;
  onSave: (resolution: string | null) => Promise<void>;
}) {
  const saved = resolution ?? '';
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = draft.trim() !== saved;
  useUnsavedChanges(dirty);

  const addTemplate = (text: string) => {
    if (!text) return;
    setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text).slice(0, RESOLUTION_MAX));
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft.trim() || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <HpsmSection title={tr('resolutionTitle')}>
      <HpsmForm columns={1}>
        <HpsmField label={tr('insertTemplate')} htmlFor="resolution-template">
          <Select
            id="resolution-template"
            labelText={tr('insertTemplate')}
            hideLabel
            value=""
            onChange={(e) => addTemplate(e.target.value)}
          >
            <SelectItem value="" text={tr('chooseToAppend')} />
            {RESOLUTION_TEMPLATES.map((t) => (
              <SelectItem key={t} value={t} text={t} />
            ))}
          </Select>
        </HpsmField>
        <HpsmField
          label={tr('resolution')}
          htmlFor="resolution-text"
          top
          help={tr('resolutionHelpLong')}
        >
          <TextArea
            id="resolution-text"
            labelText={tr('resolution')}
            hideLabel
            rows={3}
            maxLength={RESOLUTION_MAX}
            placeholder={tr('resolutionPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </HpsmField>
        <HpsmFormActions>
          <span className="dl-resolution__count">
            {draft.length}/{RESOLUTION_MAX}
          </span>
          <button
            type="button"
            className="dl-btn dl-btn--primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {tr('saveResolution')}
          </button>
        </HpsmFormActions>
      </HpsmForm>
    </HpsmSection>
  );
}
