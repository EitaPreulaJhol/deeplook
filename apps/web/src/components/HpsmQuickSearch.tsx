import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, IocKind } from '../api/types';
import { t } from '../i18n/shell';
import { iocHref, looksLikeIoc } from './iocs';
import { kbHref } from './kb';

const SHA256 = /^[a-f0-9]{64}$/i;
/** ids das amostras sao cuids (ex.: cm3x9...). */
const ENTRY_ID = /^c[a-z0-9]{20,32}$/;

/**
 * "Ir para…" no masthead (Ctrl+K): ID ou SHA-256 de uma amostra abrem a amostra
 * direto; um indicador (IP, dominio, e-mail, hash, URL - inclusive desarmado)
 * abre a ficha do indicador; o titulo exato de um artigo abre o artigo ("kb:
 * termo" busca na base); qualquer outro texto abre a Busca (item 68), que procura
 * em amostras, relatorios, comentarios, base e casos.
 */
export function HpsmQuickSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    setBusy(true);
    let target = `/busca?q=${encodeURIComponent(text)}`;
    try {
      if (SHA256.test(text)) {
        const res = await api.get<{ items: Entry[]; total: number }>(
          `/entries?scope=all&limit=2&sha256=${text.toLowerCase()}`,
        );
        // Uma amostra com o arquivo: abre a amostra; senao, a ficha do hash.
        target =
          res.total === 1 ? `/entries/${res.items[0].id}` : iocHref('SHA256', text.toLowerCase());
      } else if (ENTRY_ID.test(text)) {
        await api.get(`/entries/${text}`);
        target = `/entries/${text}`;
      } else if (/^kb:/i.test(text)) {
        // "kb: termo" busca direto na base de conhecimento.
        target = `/kb?q=${encodeURIComponent(text.slice(3).trim())}`;
      } else if (looksLikeIoc(text)) {
        // No corpo, nao na query: o link colado pode ter o token da vitima (item 166).
        const res = await api.post<{ ioc: { kind: IocKind; value: string } }>('/iocs/resolve', {
          text,
        });
        target = iocHref(res.ioc.kind, res.ioc.value);
      } else {
        // Titulo exato de um artigo da base: abre o artigo.
        const res = await api.get<{ items: { id: string; title: string }[] }>(
          `/kb?limit=5&q=${encodeURIComponent(text)}`,
        );
        const article = res.items.find((a) => a.title.toLowerCase() === text.toLowerCase());
        if (article) target = kbHref(article.id);
      }
    } catch {
      /* nao encontrou como ID: cai na busca por texto */
    } finally {
      setBusy(false);
    }
    setValue('');
    (document.activeElement as HTMLElement | null)?.blur();
    navigate(target);
  };

  return (
    <form className="hpsm-quicksearch" role="search" onSubmit={go}>
      <label htmlFor="dl-quick-search" className="hpsm-quicksearch__label">
        {t('goTo')}
      </label>
      <input
        id="dl-quick-search"
        className="hpsm-quicksearch__input"
        type="search"
        placeholder={t('quickSearchPlaceholder')}
        autoComplete="off"
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}
