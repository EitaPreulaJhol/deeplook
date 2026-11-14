import { TextInput } from '@carbon/react';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';
import type { ReportEvidence as Evidence } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/entry';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField } from './HpsmForm';
import { HpsmMessage } from './messages';

/** Endereco da imagem (autenticado pela sessao). */
export const evidenceUrl = (id: string) => `/api/evidence/${id}`;

/** Limites da API (routes/evidence.ts). */
const MAX_MB = 10;
const MAX_ITEMS = 20;
const ACCEPT = 'image/png,image/jpeg,image/webp';

function caption(e: Evidence, index: number): string {
  return e.caption || t('evidenceN', { n: index + 1 });
}

/**
 * Visualizacao ampliada: imagem inteira, legenda e dados; setas trocam de
 * imagem, Esc fecha e o foco volta para a miniatura.
 */
function EvidenceViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: Evidence[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowRight' && index < items.length - 1) {
      event.preventDefault();
      onIndex(index + 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      onIndex(index - 1);
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box dl-evidence-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {caption(item, index)}
        </h2>
        <div className="dl-evidence-viewer__img">
          <img src={evidenceUrl(item.id)} alt={caption(item, index)} />
        </div>
        <p className="dl-evidence-viewer__meta">
          {t('imageInfo', {
            n: index + 1,
            total: items.length,
            width: item.width,
            height: item.height,
            size: formatFileSize(item.size),
            by: item.uploadedBy?.displayName ?? '—',
            date: new Date(item.createdAt).toLocaleString(intlLocale()),
          })}
        </p>
        <div className="hpsm-modal__actions">
          <button
            type="button"
            className="dl-btn"
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          >
            {t('prevRecord')}
          </button>
          <button
            type="button"
            className="dl-btn"
            disabled={index === items.length - 1}
            onClick={() => onIndex(index + 1)}
          >
            {t('nextRecord')}
          </button>
          <a className="dl-btn" href={evidenceUrl(item.id)} target="_blank" rel="noreferrer">
            {t('openNewTab')}
          </a>
          <button ref={closeRef} type="button" className="dl-btn dl-btn--primary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Evidencias do relatorio (item 76): miniaturas que ampliam no clique e, para
 * quem edita o relatorio, "Adicionar imagens…" (PNG, JPEG ou WebP; os metadados
 * sao removidos no servidor), legenda e exclusao.
 */
export function ReportEvidence({
  reportId,
  items,
  canEdit,
  onChanged,
}: {
  reportId: string;
  items: Evidence[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [newCaption, setNewCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!items.length && !canEdit) return null;

  const upload = async (files: File[]) => {
    setMsg(null);
    const room = MAX_ITEMS - items.length;
    const chosen = files.slice(0, Math.max(0, room));
    const errors: string[] = [];
    if (files.length > chosen.length) {
      errors.push(t('maxImages', { max: MAX_ITEMS }));
    }
    setBusy(true);
    let added = 0;
    for (const file of chosen) {
      if (file.size > MAX_MB * 1024 * 1024) {
        errors.push(t('tooLarge', { name: file.name, max: MAX_MB }));
        continue;
      }
      const form = new FormData();
      form.append('caption', newCaption);
      form.append('file', file);
      try {
        await api.post(`/reports/${reportId}/evidence`, form);
        added += 1;
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (added) {
      setNewCaption('');
      onChanged();
    }
    setMsg(
      errors.length
        ? {
            ok: false,
            text:
              (added ? `${t('imagesAdded', { n: added })} ` : '') +
              t('notSent', { list: errors.join('; ').replace(/\.$/, '') }),
          }
        : {
            ok: true,
            text: `${t('imagesAdded', { n: added })} ${t('metadataRemoved')}`,
          },
    );
  };

  const editCaption = async (e: Evidence, index: number) => {
    const text = await prompt({
      title: t('captionTitle'),
      label: t('caption'),
      defaultValue: e.caption ?? '',
      maxLength: 300,
      confirmLabel: t('save'),
    });
    if (text === null) return;
    try {
      await api.patch(`/evidence/${e.id}`, { caption: text });
      setMsg({ ok: true, text: t('captionUpdated', { caption: caption(e, index).toLowerCase() }) });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const remove = async (e: Evidence, index: number) => {
    const ok = await confirm({
      title: t('deleteEvidence'),
      message: t('deleteEvidenceConfirm', { caption: caption(e, index) }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/evidence/${e.id}`);
      setMsg({ ok: true, text: t('evidenceDeleted') });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <HpsmField label={t('evidences', { n: items.length })} wide top>
      <div className="dl-evidence">
        {msg && (
          <HpsmMessage key={msg.text} kind={msg.ok ? 'success' : 'error'}>
            {msg.text}
          </HpsmMessage>
        )}
        {items.length > 0 && (
          <ul className="dl-evidence__grid">
            {items.map((e, i) => (
              <li key={e.id} className="dl-evidence__item">
                <button
                  type="button"
                  className="dl-evidence__thumb"
                  aria-label={t('enlarge', { caption: caption(e, i) })}
                  onClick={() => setViewing(i)}
                >
                  <img src={evidenceUrl(e.id)} alt="" loading="lazy" />
                </button>
                <span className="dl-evidence__caption" title={caption(e, i)}>
                  {caption(e, i)}
                </span>
                {canEdit && (
                  <span className="dl-evidence__actions">
                    <button
                      type="button"
                      className="dl-link-button"
                      onClick={() => void editCaption(e, i)}
                    >
                      {t('captionEllipsis')}
                    </button>
                    <button
                      type="button"
                      className="dl-link-button"
                      onClick={() => void remove(e, i)}
                    >
                      {t('delete')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && items.length < MAX_ITEMS && (
          <div className="dl-evidence__add">
            <TextInput
              id={`evidence-caption-${reportId}`}
              labelText={t('captionOptional')}
              hideLabel
              placeholder={t('captionOptional')}
              size="sm"
              maxLength={300}
              value={newCaption}
              onChange={(e) => setNewCaption(e.target.value)}
            />
            <input
              ref={fileRef}
              id={`evidence-file-${reportId}`}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => void upload([...(e.target.files ?? [])])}
            />
            <button
              type="button"
              className="dl-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? t('sending') : t('addImages')}
            </button>
            <span className="dl-hint-muted">{t('imagesHelp', { max: MAX_MB })}</span>
          </div>
        )}
      </div>
      {viewing !== null && items[viewing] && (
        <EvidenceViewer
          items={items}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </HpsmField>
  );
}
