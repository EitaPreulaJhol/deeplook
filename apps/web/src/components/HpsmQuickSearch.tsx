import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, IocKind } from '../api/types';
import { iocHref, looksLikeIoc } from './iocs';

const SHA256 = /^[a-f0-9]{64}$/i;
/** ids das amostras sao cuids (ex.: cm3x9...). */
const ENTRY_ID = /^c[a-z0-9]{20,32}$/;

/**
 * "Ir para…" no masthead (Ctrl+K): ID ou SHA-256 de uma amostra abrem a amostra
 * direto; um indicador (IP, dominio, e-mail, hash, URL - inclusive desarmado)
 * abre a ficha do indicador; qualquer outro texto abre o Historico Global com a
 * busca preenchida.
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
    let target = `/history?q=${encodeURIComponent(text)}`;
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
      } else if (looksLikeIoc(text)) {
        const res = await api.get<{ ioc: { kind: IocKind; value: string } }>(
          `/iocs/lookup?q=${encodeURIComponent(text)}`,
        );
        target = iocHref(res.ioc.kind, res.ioc.value);
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
        Ir para:
      </label>
      <input
        id="dl-quick-search"
        className="hpsm-quicksearch__input"
        type="search"
        placeholder="ID, SHA-256, IOC ou texto (Ctrl+K)"
        autoComplete="off"
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}
