import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';

type LinkStatus = 'new' | 'existing' | 'in-case' | 'limit';
type HashStatus = 'existing' | 'in-case' | 'unknown';

interface Preview {
  name: string | null;
  links: { url: string; status: LinkStatus; entry: { id: string; title: string } | null }[];
  hashes: { sha256: string; status: HashStatus; entry: { id: string; title: string } | null }[];
  others: number;
  invalid: number;
  maxNewLinks: number;
}

interface Result {
  created: number;
  linked: number;
  added: number;
  unknown: number;
  skipped: number;
}

const MAX_BYTES = 2 * 1024 * 1024;
const SHOWN = 100;

const LINK_LABEL: Record<LinkStatus, string> = {
  new: 'Vira amostra nova',
  existing: 'Já é amostra: entra no caso',
  'in-case': 'Já está no caso',
  limit: 'Acima do limite: não entra',
};
const HASH_LABEL: Record<HashStatus, string> = {
  existing: 'Já foi enviado: entra no caso',
  'in-case': 'Já está no caso',
  unknown: 'Nunca enviado: não entra',
};

/**
 * Importar um pacote STIX 2.1 num caso (revisao de novembro, 3.5): escolhe o arquivo (o pacote
 * de outro DeepLook, de um TIP ou de um parceiro), ve o que vai acontecer com cada link e cada
 * arquivo e confirma. Links viram amostras; arquivos so entram se o mesmo SHA-256 ja foi enviado.
 */
export function CaseStixImportDialog({
  caseId,
  onClose,
  onDone,
}: {
  caseId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    chooseRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

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
    setPreview(null);
    if (file.size > MAX_BYTES) {
      setError('Arquivo grande demais (máximo 2 MB).');
      return;
    }
    const content = await file.text();
    setText(content);
    setFileName(file.name);
    setBusy(true);
    try {
      setPreview(await api.post<Preview>(`/cases/${caseId}/stix/preview`, { text: content }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entering =
    (preview?.links.filter((l) => l.status === 'new' || l.status === 'existing').length ?? 0) +
    (preview?.hashes.filter((h) => h.status === 'existing').length ?? 0);

  const runImport = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<Result>(`/cases/${caseId}/stix/import`, { text });
      onDone(
        `Pacote importado: ${r.created} link(s) novo(s) como amostra e ${r.linked} amostra(s) que já existiam` +
          `${r.unknown ? `; ${r.unknown} arquivo(s) nunca enviado(s) ficaram de fora` : ''}. O resumo está no histórico do caso.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box dl-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          Importar pacote STIX no caso
        </h2>
        <div className="dl-import__body">
          <p className="dl-import__hint">
            Um pacote <strong>STIX 2.1</strong> (JSON, até 2 MB), por exemplo o exportado de outro
            DeepLook em Exportar &gt; Pacote do caso. Os <strong>links</strong> viram amostras do
            caso (até {preview?.maxNewLinks ?? 50} novos por vez); os <strong>arquivos</strong> só
            entram se o mesmo SHA-256 já foi enviado ao DeepLook, porque o pacote não traz o
            arquivo. Domínios, IPs e e-mails não entram aqui: para segui-los, use Importar
            indicadores.
          </p>
          <div className="dl-import__row">
            <input
              ref={fileRef}
              id="case-stix-file"
              type="file"
              accept=".json,application/json,application/stix+json"
              hidden
              onChange={(e) => void loadFile(e.target.files?.[0])}
            />
            <button
              ref={chooseRef}
              type="button"
              className="dl-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Escolher arquivo…
            </button>
            {fileName && <span className="dl-mono">{fileName}</span>}
            {busy && !preview && <span>Lendo...</span>}
          </div>

          {error && (
            <p className="dl-import__error" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <div className="dl-import__preview" aria-live="polite">
              <p className="dl-import__summary">
                {preview.name ? `Pacote "${preview.name}"` : 'Pacote sem nome'}:{' '}
                <strong>{entering} amostra(s) entram no caso</strong>
                {preview.others > 0 && `, ${preview.others} outro(s) indicador(es) não entram`}
                {preview.invalid > 0 && `, ${preview.invalid} inválido(s)`}.
              </p>
              {preview.links.length > 0 && (
                <table className="dl-import__table" aria-label="Links do pacote">
                  <thead>
                    <tr>
                      <th scope="col">Link</th>
                      <th scope="col">O que acontece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.links.slice(0, SHOWN).map((l) => (
                      <tr key={l.url} className={`is-${l.status}`}>
                        <td className="dl-mono">{l.url}</td>
                        <td>{LINK_LABEL[l.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.hashes.length > 0 && (
                <table className="dl-import__table" aria-label="Arquivos do pacote">
                  <thead>
                    <tr>
                      <th scope="col">SHA-256</th>
                      <th scope="col">O que acontece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.hashes.slice(0, SHOWN).map((h) => (
                      <tr key={h.sha256} className={`is-${h.status}`}>
                        <td className="dl-mono">{h.sha256}</td>
                        <td>{HASH_LABEL[h.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.links.length + preview.hashes.length > 2 * SHOWN && (
                <p className="dl-hint-muted">Lista cortada: o resumo acima conta tudo.</p>
              )}
            </div>
          )}
        </div>
        <div className="hpsm-modal__actions">
          <button
            type="button"
            className="dl-btn dl-btn--primary"
            disabled={busy || !preview || entering === 0}
            onClick={() => void runImport()}
          >
            {busy && preview ? 'Importando...' : `Importar ${entering}`}
          </button>
          <button type="button" className="dl-btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
