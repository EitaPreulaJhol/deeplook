import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { GhidraFunction, GhidraInfo } from '../api/types';
import { intlLocale } from '../i18n';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
/** Maiores funcoes mostradas (o resumo traz ate 300). */
const LARGEST_SHOWN = 20;

/** Analise com o Ghidra da amostra; atualiza a cada 5 s enquanto esta na fila ou analisando. */
export function useGhidra(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ghidra', entryId],
    queryFn: () => api.get<GhidraInfo>(`/entries/${entryId}/ghidra`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.analysis?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(a: NonNullable<GhidraInfo['analysis']>): { tone: StatusTone; text: string } {
  if (a.status === 'PENDING') {
    const retry = a.attempts > 0 && a.error ? ` (nova tentativa: ${a.error})` : '';
    return { tone: 'blue', text: `Na fila${a.ahead ? `, ${a.ahead} antes desta` : ''}${retry}` };
  }
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: `Analisando desde ${fmtDate(a.startedAt)}` };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: `Falhou: ${a.error ?? 'erro desconhecido'}` };
  return { tone: 'green', text: `Concluída em ${fmtDate(a.finishedAt)}` };
}

function DecompiledFunction({ fn }: { fn: GhidraFunction }) {
  const label = [
    fn.isEntryPoint ? 'ponto de entrada' : null,
    fn.sensitive.length ? `chama ${fn.sensitive.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <details className="dl-static-strings dl-ghidra-fn">
      <summary>
        <code>{fn.name}</code> <span className="dl-hint-muted">{fn.entry}</span>
        {label && <> · {label}</>}
      </summary>
      {fn.callers.length > 0 && (
        <p className="dl-ghidra-fn__callers">Chamada por: {fn.callers.join(', ')}</p>
      )}
      {fn.c ? (
        <>
          <div className="dl-ghidra-fn__tools">
            <CopyButton value={fn.c} label={`pseudo-C de ${fn.name}`} />
            {fn.truncated && <span className="dl-hint-muted"> (cortado em 20 mil caracteres)</span>}
          </div>
          <pre className="dl-doc-macros__code" aria-label={`Pseudo-C de ${fn.name}`}>
            {fn.c}
          </pre>
        </>
      ) : (
        <p className="dl-static-empty">
          O descompilador não conseguiu: {fn.error ?? 'sem motivo'}.
        </p>
      )}
    </details>
  );
}

/**
 * Secao "Analise com o Ghidra" da aba Detalhes (item 7.3): sob demanda, so executaveis do Windows
 * e do Linux. Analistas pedem; quem ve a amostra ve o resultado; quem pode baixar a amostra baixa o
 * projeto .gzf (que tem os bytes dela).
 */
export function GhidraSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useGhidra(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.applicable && !info.analysis)) return null;
  const a = info.analysis;

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/ghidra`, {});
      await queryClient.invalidateQueries({ queryKey: ['ghidra', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = a?.status === 'PENDING' || a?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.eligible && !busy ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? 'Pedindo...' : a ? 'Analisar de novo' : 'Analisar com o Ghidra'}
      </button>
    ) : null;

  if (!a) {
    return (
      <HpsmSection title="Análise com o Ghidra">
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {!info.enabled
            ? 'A análise com o Ghidra está desligada (GHIDRA_URL vazio).'
            : info.reason
              ? info.reason
              : 'Sob demanda: um analista pede, e o resultado aparece aqui (de segundos a minutos).'}{' '}
          {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(a);
  const s = a.summary;
  return (
    <HpsmSection title="Análise com o Ghidra">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField
          label="Situação"
          help="Funções, quem chama APIs sensíveis e o pseudo-C delas. O Ghidra lê o código; nada é executado."
        >
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Pedida por">
          <HpsmReadonly>
            {a.requestedBy?.displayName ?? '—'} em {fmtDate(a.createdAt)}
          </HpsmReadonly>
        </HpsmField>
        {s && (
          <>
            <HpsmField label="Programa">
              <HpsmReadonly>
                {[s.format, s.language, s.compiler].filter(Boolean).join(' · ')}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Funções">
              <HpsmReadonly>
                {s.functions} função(ões), {s.thunks} thunk(s) ·{' '}
                {s.sensitiveFunctions ? (
                  <StatusText tone="orange">
                    {s.sensitiveFunctions} chamam APIs sensíveis
                  </StatusText>
                ) : (
                  'nenhuma chama APIs sensíveis'
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Base e entrada">
              <HpsmReadonly>
                <code>{s.imageBase ?? '—'}</code> · entrada <code>{s.entryPoint ?? '—'}</code>
              </HpsmReadonly>
            </HpsmField>
            <HpsmField
              label="Projeto"
              help="Para abrir no Ghidra local (File > Open... / Import). Tem os bytes da amostra: manuseie como ela."
            >
              <HpsmReadonly>
                {a.hasProject && info.canDownload ? (
                  <a className="dl-link" href={`/api/entries/${entryId}/ghidra/project`} download>
                    Baixar projeto (.gzf, {formatFileSize(a.gzfSize ?? 0)})
                  </a>
                ) : a.hasProject ? (
                  'Só quem enviou e os analistas baixam.'
                ) : (
                  (a.gzfError ?? '—')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Ferramenta">
              <HpsmReadonly>
                Ghidra {a.version ?? '?'}
                {a.ms !== null && ` · ${Math.round(a.ms / 1000)} s`}
              </HpsmReadonly>
            </HpsmField>
          </>
        )}
      </HpsmForm>

      {s && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Pseudo-C ({s.decompiled.length})</h4>
          <p className="dl-related-hint">
            O ponto de entrada e as funções que mais chamam APIs sensíveis, como o descompilador do
            Ghidra as vê. Nomes como FUN_140001451 são de funções sem símbolo.
          </p>
          {s.decompiled.map((fn) => (
            <DecompiledFunction key={fn.entry} fn={fn} />
          ))}
        </div>
      )}

      {s && s.largest.length > 0 && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Maiores funções</h4>
          <TableContainer>
            <Table size="xs" aria-label="Maiores funções do executável">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Função</TableHeader>
                  <TableHeader scope="col">Endereço</TableHeader>
                  <TableHeader scope="col">Tamanho</TableHeader>
                  <TableHeader scope="col">Complexidade</TableHeader>
                  <TableHeader scope="col">Chama / chamada por</TableHeader>
                  <TableHeader scope="col">APIs</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {s.largest.slice(0, LARGEST_SHOWN).map((f) => (
                  <TableRow key={f.entry}>
                    <TableCell>
                      <code>{f.name}</code>
                    </TableCell>
                    <TableCell>
                      <code>{f.entry}</code>
                    </TableCell>
                    <TableCell>{formatFileSize(f.size)}</TableCell>
                    <TableCell>{f.complexity >= 0 ? f.complexity : '—'}</TableCell>
                    <TableCell>
                      {f.calls} / {f.callers}
                    </TableCell>
                    <TableCell>
                      <span title={f.apis.join('\n')}>
                        {f.apis.slice(0, 3).join(', ')}
                        {f.apis.length > 3 ? ` (+${f.apis.length - 3})` : ''}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </HpsmSection>
  );
}
