import { TextArea, TextInput } from '@carbon/react';
import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';
import type { IocKind } from '../api/types';
import { IOC_KIND_LABELS } from './iocs';

type Target = 'watch' | 'allow';
type Status = 'new' | 'exists' | 'covered' | 'limit';

interface Preview {
  format: 'csv' | 'stix';
  items: { kind: IocKind; value: string; where: string; fromUrl?: boolean; status: Status }[];
  invalid: { where: string; text: string; reason: string }[];
  repeated: number;
  counts: Record<Status, number>;
  room: number | null;
}

/** Linhas mostradas por tabela (o resto vira "+N"). */
const SHOWN = 200;
const MAX_BYTES = 2 * 1024 * 1024;

const STATUS: Record<Target, Record<Status, string>> = {
  watch: { new: 'Novo', exists: 'Já sigo', covered: '—', limit: 'Sem vaga (limite de 200)' },
  allow: {
    new: 'Novo',
    exists: 'Já permitido',
    covered: 'Já coberto (domínio ou faixa)',
    limit: '—',
  },
};

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
      setError('Arquivo grande demais (máximo 2 MB).');
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
      setError('Diga por que esses indicadores são legítimos (motivo, 3 a 300 caracteres).');
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
          ? `${res.added} indicador(es) passaram a ser seguidos.`
          : `${res.added} indicador(es) incluídos na lista de permissões.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    target === 'watch' ? 'Importar indicadores para seguir' : 'Importar indicadores permitidos';
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
            Um indicador por linha (CSV com ou sem coluna de tipo; hxxp e [.] são aceitos) ou um
            pacote <strong>STIX 2.1</strong> (JSON). Até 5000 linhas ou 2 MB. Nada é consultado na
            internet.
            {target === 'watch' && ' Faixas de IP e IPs privados não podem ser seguidos.'}
          </p>
          <TextArea
            id="import-text"
            ref={textRef}
            labelText="Lista ou pacote STIX"
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
              Escolher arquivo…
            </button>
            <button
              type="button"
              className="dl-btn dl-btn--primary"
              disabled={busy || !text.trim()}
              onClick={() => void runPreview()}
            >
              {busy && !preview ? 'Lendo...' : 'Pré-visualizar'}
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
                {preview.format === 'stix' ? 'Pacote STIX' : 'Lista'}:{' '}
                <strong>{preview.counts.new} novo(s)</strong>
                {preview.counts.exists > 0 &&
                  `, ${preview.counts.exists} ${target === 'watch' ? 'já seguido(s)' : 'já permitido(s)'}`}
                {preview.counts.covered > 0 && `, ${preview.counts.covered} já coberto(s)`}
                {preview.counts.limit > 0 && `, ${preview.counts.limit} sem vaga`}
                {preview.invalid.length > 0 && `, ${preview.invalid.length} inválido(s)`}
                {preview.repeated > 0 && `, ${preview.repeated} repetido(s)`}.
                {preview.room !== null && ` Vagas para seguir: ${preview.room}.`}
              </p>
              {preview.items.length > 0 && (
                <table className="dl-import__table" aria-label="Indicadores reconhecidos">
                  <thead>
                    <tr>
                      <th scope="col">Tipo</th>
                      <th scope="col">Indicador</th>
                      <th scope="col">Onde</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, SHOWN).map((i) => (
                      <tr key={`${i.kind}:${i.value}`} className={`is-${i.status}`}>
                        <td>{IOC_KIND_LABELS[i.kind]}</td>
                        <td className="dl-mono">
                          {i.value}
                          {i.fromUrl && <span className="dl-hint-muted"> (de uma URL)</span>}
                        </td>
                        <td>{i.where}</td>
                        <td>{STATUS[target][i.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.items.length > SHOWN && (
                <p className="dl-hint-muted">+{preview.items.length - SHOWN} reconhecidos</p>
              )}
              {preview.invalid.length > 0 && (
                <>
                  <h3 className="dl-import__subhead">Não importados</h3>
                  <table className="dl-import__table" aria-label="Linhas não importadas">
                    <thead>
                      <tr>
                        <th scope="col">Onde</th>
                        <th scope="col">Texto</th>
                        <th scope="col">Motivo</th>
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
                      +{preview.invalid.length - SHOWN} não importados
                    </p>
                  )}
                </>
              )}
              {target === 'allow' && fresh.length > 0 && (
                <TextInput
                  id="import-reason"
                  labelText="Motivo (vale para todos)"
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
            {busy && preview ? 'Importando...' : `Importar ${fresh.length}`}
          </button>
          <button type="button" className="dl-btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
