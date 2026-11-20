import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/analysis';
import { HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';

interface DocumentIcon {
  hash: string;
  label: string;
  createdAt: string;
}

const useDocumentIcons = (enabled = true) =>
  useQuery({
    queryKey: ['document-icons'],
    queryFn: () => api.get<{ icons: DocumentIcon[] }>('/document-icons'),
    enabled,
  });

/**
 * Na ficha (item 2): o admin marca o icone desta amostra como "icone de documento" (Word, PDF...).
 * Todo executavel com icone parecido ganha o alerta de isca, inclusive os que ja estao na base.
 */
export function MarkDocumentIcon({ entryId, hash }: { entryId: string; hash: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const list = useDocumentIcons(isAdmin);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!isAdmin) return null;
  const marked = list.data?.icons.find((i) => i.hash === hash);
  if (marked)
    return <span className="dl-hint-muted"> · {t('docIconMarked', { label: marked.label })}</span>;
  const save = async () => {
    try {
      const r = await api.post<{ changed: number }>('/document-icons', {
        entryId,
        label: label.trim(),
      });
      setMsg({ ok: true, text: t('docIconSaved', { n: r.changed }) });
      await queryClient.invalidateQueries({ queryKey: ['document-icons'] });
      await queryClient.invalidateQueries({ queryKey: ['entry', entryId] });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  return (
    <span className="dl-doc-icon">
      {' '}
      <input
        aria-label={t('docIconLabel')}
        placeholder={t('docIconLabel')}
        value={label}
        maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
      />{' '}
      <button
        type="button"
        className="dl-link-button"
        disabled={label.trim().length < 2}
        onClick={save}
      >
        {t('docIconMark')}
      </button>
      {msg && <HpsmMessage kind={msg.ok ? 'success' : 'error'}>{msg.text}</HpsmMessage>}
    </span>
  );
}

/** Em Administracao > Configuracoes: a lista, com a remocao. */
export function DocumentIconsSettings() {
  const queryClient = useQueryClient();
  const list = useDocumentIcons();
  const [error, setError] = useState<string | null>(null);
  const remove = async (hash: string) => {
    try {
      await api.del(`/document-icons/${hash}`);
      await queryClient.invalidateQueries({ queryKey: ['document-icons'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const icons = list.data?.icons ?? [];
  return (
    <HpsmSection title={t('docIconTitle')}>
      <p className="dl-hint-muted">{t('docIconHelp')}</p>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {icons.length === 0 ? (
        <p className="dl-static-empty">{t('docIconNone')}</p>
      ) : (
        <ul className="dl-die-list">
          {icons.map((i) => (
            <li key={i.hash}>
              {i.label} <code>{i.hash}</code>{' '}
              <button type="button" className="dl-link-button" onClick={() => void remove(i.hash)}>
                {t('docIconRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </HpsmSection>
  );
}
