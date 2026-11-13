import { TextInput } from '@carbon/react';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';
import type { ReportEvidence as Evidence } from '../api/types';
import { intlLocale } from '../i18n';
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
  return e.caption || `Evidência ${index + 1}`;
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
          Imagem {index + 1} de {items.length} · {item.width}×{item.height} ·{' '}
          {formatFileSize(item.size)} · {item.uploadedBy?.displayName ?? '—'},{' '}
          {new Date(item.createdAt).toLocaleString(intlLocale())}
        </p>
        <div className="hpsm-modal__actions">
          <button
            type="button"
            className="dl-btn"
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          >
            ◀ Anterior
          </button>
          <button
            type="button"
            className="dl-btn"
            disabled={index === items.length - 1}
            onClick={() => onIndex(index + 1)}
          >
            Próxima ▶
          </button>
          <a className="dl-btn" href={evidenceUrl(item.id)} target="_blank" rel="noreferrer">
            Abrir em nova aba
          </a>
          <button ref={closeRef} type="button" className="dl-btn dl-btn--primary" onClick={onClose}>
            Fechar
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
      errors.push(`no máximo ${MAX_ITEMS} imagens por relatório`);
    }
    setBusy(true);
    let added = 0;
    for (const file of chosen) {
      if (file.size > MAX_MB * 1024 * 1024) {
        errors.push(`${file.name}: maior que ${MAX_MB} MB`);
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
            text: `${added ? `${added} imagem(ns) adicionada(s). ` : ''}Não enviadas: ${errors.join('; ').replace(/\.$/, '')}.`,
          }
        : {
            ok: true,
            text: `${added} imagem(ns) adicionada(s). Metadados (EXIF, GPS, aparelho) removidos.`,
          },
    );
  };

  const editCaption = async (e: Evidence, index: number) => {
    const text = await prompt({
      title: 'Legenda da evidência',
      label: 'Legenda',
      defaultValue: e.caption ?? '',
      maxLength: 300,
      confirmLabel: 'Salvar',
    });
    if (text === null) return;
    try {
      await api.patch(`/evidence/${e.id}`, { caption: text });
      setMsg({ ok: true, text: `Legenda da ${caption(e, index).toLowerCase()} atualizada.` });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const remove = async (e: Evidence, index: number) => {
    const ok = await confirm({
      title: 'Excluir evidência',
      message: `Excluir "${caption(e, index)}"? A imagem é apagada do armazenamento.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/evidence/${e.id}`);
      setMsg({ ok: true, text: 'Evidência excluída.' });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <HpsmField label={`Evidências (${items.length})`} wide top>
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
                  aria-label={`Ampliar: ${caption(e, i)}`}
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
                      Legenda…
                    </button>
                    <button
                      type="button"
                      className="dl-link-button"
                      onClick={() => void remove(e, i)}
                    >
                      Excluir
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
              labelText="Legenda (opcional)"
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
              {busy ? 'Enviando...' : 'Adicionar imagens…'}
            </button>
            <span className="dl-hint-muted">
              PNG, JPEG ou WebP, até {MAX_MB} MB; EXIF/GPS removidos no servidor.
            </span>
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
