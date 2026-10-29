import { Select, SelectItem, TextArea } from '@carbon/react';
import { useEffect, useState } from 'react';

import type { Verdict } from '../api/types';
import { HpsmField, HpsmForm, HpsmFormActions, HpsmSection } from './HpsmForm';
import { useUnsavedChanges } from './useUnsavedChanges';

/** Mesmo limite da API (routes/entries.ts). */
export const RESOLUTION_MAX = 500;

/** Modelos para quem enviou: o que fazer, sem detalhes tecnicos. */
export const RESOLUTION_TEMPLATES = [
  'É golpe: não clique nos links, não abra os anexos e apague a mensagem.',
  'Clicou no link ou digitou a senha? Troque a senha agora e avise o suporte.',
  'Abriu o anexo? Desconecte o computador da rede e avise o suporte.',
  'Ainda suspeito: não abra até a equipe concluir a análise.',
  'Seguro: pode abrir.',
  'Legítimo, mas desnecessário: pode apagar.',
];

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
      <span className="dl-resolution__title">O que fazer (orientação da equipe de segurança)</span>
      <span className="dl-resolution__text">{resolution}</span>
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
    <HpsmSection title="Resolução para quem enviou">
      <HpsmForm columns={1}>
        <HpsmField label="Inserir modelo" htmlFor="resolution-template">
          <Select
            id="resolution-template"
            labelText="Inserir modelo"
            hideLabel
            value=""
            onChange={(e) => addTemplate(e.target.value)}
          >
            <SelectItem value="" text="— Escolha para acrescentar ao texto —" />
            {RESOLUTION_TEMPLATES.map((t) => (
              <SelectItem key={t} value={t} text={t} />
            ))}
          </Select>
        </HpsmField>
        <HpsmField
          label="Resolução"
          htmlFor="resolution-text"
          top
          help="Para quem enviou: curta e sem detalhes técnicos. Aparece em destaque na ficha, em Meus Uploads e no aviso de conclusão."
        >
          <TextArea
            id="resolution-text"
            labelText="Resolução"
            hideLabel
            rows={3}
            maxLength={RESOLUTION_MAX}
            placeholder="ex.: É golpe: não clique nos links e apague a mensagem."
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
            Salvar resolução
          </button>
        </HpsmFormActions>
      </HpsmForm>
    </HpsmSection>
  );
}
