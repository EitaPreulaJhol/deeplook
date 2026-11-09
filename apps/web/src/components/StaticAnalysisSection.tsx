import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { StaticInfo } from '../api/types';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { HpsmMessage } from './messages';
import { PeAlerts, PeExtraBlocks, PeHeaderFields, SectionFlags } from './PeDetails';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

const ENTROPY: Record<StaticInfo['entropyLevel'], { tone: StatusTone; text: string }> = {
  low: { tone: 'none', text: 'baixa (texto, zeros, pouca variação)' },
  normal: { tone: 'none', text: 'normal' },
  high: { tone: 'orange', text: 'alta: provável compactação, criptografia ou empacotamento' },
};

const STRING_GROUPS: { key: keyof Omit<StaticInfo['strings'], 'total'>; label: string }[] = [
  { key: 'suspicious', label: 'Palavras suspeitas' },
  { key: 'urls', label: 'URLs' },
  { key: 'ips', label: 'IPs públicos' },
  { key: 'emails', label: 'E-mails' },
  { key: 'paths', label: 'Caminhos' },
  { key: 'registry', label: 'Chaves de registro' },
];

/** Aviso no topo da ficha: executavel disfarcado com outra extensao. */
export function DisguisedFileWarning({ info }: { info?: StaticInfo | null }) {
  const mismatch = info?.extensionMismatch;
  if (!mismatch?.dangerous || !info?.detectedType) return null;
  return (
    <HpsmMessage kind="warning">
      Atenção: o nome diz <strong>.{mismatch.declared}</strong>, mas o conteúdo é{' '}
      <strong>{info.detectedType.label}</strong>. Não abra fora do ambiente isolado.
    </HpsmMessage>
  );
}

/**
 * Secao "Analise estatica" da aba Detalhes: tipo real, entropia, cabecalho PE
 * (secoes, imports, funcoes suspeitas, empacotador), strings por categoria e
 * IOCs sugeridos (links para a ficha do indicador). Sem analise (amostras
 * antigas), analistas podem pedir agora.
 */
export function StaticAnalysisSection({
  entryId,
  info,
  canTriage,
  purged = false,
}: {
  entryId: string;
  info?: StaticInfo | null;
  canTriage: boolean;
  /** Arquivo expurgado pela retencao: nao ha o que (re)analisar. */
  purged?: boolean;
}) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.post(`/entries/${entryId}/static-analysis`, {});
      await queryClient.invalidateQueries({ queryKey: ['entry', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (!info) {
    return (
      <HpsmSection title="Análise estática">
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {purged
            ? 'Sem análise estática: o arquivo foi expurgado pela política de retenção antes de ser analisado.'
            : 'Esta amostra foi enviada antes da análise estática.'}{' '}
          {canTriage && !purged && (
            <button type="button" className="dl-link-button" disabled={running} onClick={analyze}>
              {running ? 'Analisando...' : 'Analisar agora'}
            </button>
          )}
        </p>
      </HpsmSection>
    );
  }

  const pe = info.pe;
  const elf = info.elf;
  const mismatch = info.extensionMismatch;
  const entropy = ENTROPY[info.entropyLevel];
  const suggested = info.iocCandidates;

  return (
    <HpsmSection title="Análise estática">
      <HpsmForm columns={2}>
        <HpsmField label="Tipo real">
          <HpsmReadonly>
            {info.detectedType?.label ?? 'Não identificado pela assinatura'}
            {mismatch && (
              <>
                {' '}
                <StatusText tone={mismatch.dangerous ? 'red' : 'orange'}>
                  {mismatch.dangerous ? 'executável disfarçado' : 'extensão divergente'}: .
                  {mismatch.declared}
                </StatusText>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Entropia">
          <HpsmReadonly>
            <StatusText tone={entropy.tone}>
              {info.entropy.toFixed(2)} de 8 — {entropy.text}
            </StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Analisado em">
          <HpsmReadonly>
            {fmtDate(info.analyzedAt)}
            {info.bytesAnalyzed < info.size &&
              ` (primeiros ${formatFileSize(info.bytesAnalyzed)} de ${formatFileSize(info.size)})`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Strings legíveis">
          <HpsmReadonly>{info.strings.total}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>

      {pe && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Executável do Windows (PE)</h4>
          {pe.imphash === undefined && (
            <p className="dl-static-empty">
              Análise anterior ao imphash, à assinatura e aos recursos: eles aparecem quando a
              reanálise em segundo plano chegar a esta amostra.{' '}
              {canTriage && !purged && (
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={running}
                  onClick={analyze}
                >
                  {running ? 'Analisando...' : 'Analisar de novo'}
                </button>
              )}
            </p>
          )}
          <HpsmForm columns={2}>
            <PeAlerts alerts={pe.alerts} />
            <HpsmField label="Arquitetura">
              <HpsmReadonly>{pe.machine}</HpsmReadonly>
            </HpsmField>
            <HpsmField label="Tipo">
              <HpsmReadonly>
                {pe.isDll ? 'Biblioteca (DLL)' : 'Programa (EXE)'} · {pe.subsystem}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Compilado em" help="Data declarada no cabeçalho; pode ser forjada.">
              <HpsmReadonly>{fmtDate(pe.compiledAt)}</HpsmReadonly>
            </HpsmField>
            <HpsmField label="Empacotador">
              <HpsmReadonly>
                {pe.packer ? (
                  <StatusText tone="orange">{pe.packer}</StatusText>
                ) : (
                  'Nenhum reconhecido'
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Funções suspeitas" wide>
              <HpsmReadonly>
                {pe.suspiciousImports.length ? (
                  <span className="dl-static-chips">
                    {pe.suspiciousImports.map((fn) => (
                      <code key={fn}>{fn}</code>
                    ))}
                  </span>
                ) : (
                  'Nenhuma da lista de atenção'
                )}
              </HpsmReadonly>
            </HpsmField>
            <PeHeaderFields pe={pe} />
          </HpsmForm>
          <div className="dl-static-tables">
            <TableContainer>
              <Table size="xs" aria-label="Seções do executável">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Seção</TableHeader>
                    <TableHeader scope="col">Tamanho virtual</TableHeader>
                    <TableHeader scope="col">Tamanho em disco</TableHeader>
                    <TableHeader scope="col">Entropia</TableHeader>
                    <TableHeader scope="col">Permissões</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pe.sections.map((s, i) => (
                    <TableRow key={`${s.name}-${i}`}>
                      <TableCell>
                        <code>{s.name || '(sem nome)'}</code>
                      </TableCell>
                      <TableCell>{formatFileSize(s.virtualSize)}</TableCell>
                      <TableCell>{formatFileSize(s.rawSize)}</TableCell>
                      <TableCell>
                        {s.entropy >= 7.2 ? (
                          <StatusText tone="orange">{s.entropy.toFixed(2)}</StatusText>
                        ) : (
                          s.entropy.toFixed(2)
                        )}
                      </TableCell>
                      <TableCell>
                        <SectionFlags flags={s.flags} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TableContainer>
              <Table size="xs" aria-label="Bibliotecas importadas">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Biblioteca importada</TableHeader>
                    <TableHeader scope="col">Funções</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pe.imports.map((imp) => (
                    <TableRow key={imp.dll}>
                      <TableCell>
                        <code>{imp.dll}</code>
                      </TableCell>
                      <TableCell>{imp.functions}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          <PeExtraBlocks pe={pe} />
        </div>
      )}

      {elf && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Executável Linux (ELF)</h4>
          <HpsmForm columns={2}>
            {elf.alerts.length > 0 && (
              <HpsmField label="Alertas" wide top>
                <ul className="dl-doc-alerts">
                  {elf.alerts.map((alert) => (
                    <li key={alert}>
                      <StatusText tone="orange">{alert}</StatusText>
                    </li>
                  ))}
                </ul>
              </HpsmField>
            )}
            <HpsmField label="Arquitetura">
              <HpsmReadonly>
                {elf.machine} · {elf.class} bits · {elf.endian === 'little' ? 'little' : 'big'}
                -endian
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Tipo">
              <HpsmReadonly>
                {elf.type}
                {elf.static ? ' · estático' : ''}
                {elf.stripped ? ' · sem símbolos (stripped)' : ''}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Carregador" help="Pedido no cabeçalho (PT_INTERP).">
              <HpsmReadonly>{elf.interpreter ? <code>{elf.interpreter}</code> : '—'}</HpsmReadonly>
            </HpsmField>
            <HpsmField label="Empacotador">
              <HpsmReadonly>
                {elf.packer ? (
                  <StatusText tone="orange">{elf.packer}</StatusText>
                ) : (
                  'Nenhum reconhecido'
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Bibliotecas" wide>
              <HpsmReadonly>
                {elf.needed.length ? (
                  <span className="dl-static-chips">
                    {elf.needed.map((lib) => (
                      <code key={lib}>{lib}</code>
                    ))}
                  </span>
                ) : (
                  'Nenhuma declarada'
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField
              label="Funções suspeitas"
              wide
              help={`${elf.importedSymbols} função(ões) importada(s) no total.`}
            >
              <HpsmReadonly>
                {elf.suspiciousSymbols.length ? (
                  <span className="dl-static-chips">
                    {elf.suspiciousSymbols.map((fn) => (
                      <code key={fn}>{fn}</code>
                    ))}
                  </span>
                ) : (
                  'Nenhuma da lista de atenção'
                )}
              </HpsmReadonly>
            </HpsmField>
          </HpsmForm>
          {elf.sections.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label="Seções do executável Linux">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Seção</TableHeader>
                    <TableHeader scope="col">Tipo</TableHeader>
                    <TableHeader scope="col">Tamanho</TableHeader>
                    <TableHeader scope="col">Entropia</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {elf.sections.map((s, i) => (
                    <TableRow key={`${s.name}-${i}`}>
                      <TableCell>
                        <code>{s.name || '(sem nome)'}</code>
                      </TableCell>
                      <TableCell>{s.type}</TableCell>
                      <TableCell>{formatFileSize(s.size)}</TableCell>
                      <TableCell>
                        {s.entropy >= 7.2 ? (
                          <StatusText tone="orange">{s.entropy.toFixed(2)}</StatusText>
                        ) : (
                          s.entropy.toFixed(2)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      <div className="dl-static-block">
        <h4 className="dl-static-title">Strings por categoria</h4>
        {STRING_GROUPS.map(({ key, label }) => {
          const items = info.strings[key];
          return (
            <details
              key={key}
              className="dl-static-strings"
              open={key === 'suspicious' && items.length > 0}
            >
              <summary>
                {label} ({items.length})
              </summary>
              {items.length ? (
                <ul>
                  {items.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dl-static-empty">Nenhuma.</p>
              )}
            </details>
          );
        })}
      </div>

      {suggested.length > 0 && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">
            IOCs sugeridos ({suggested.length}){' '}
            <CopyButton value={suggested.map((i) => i.value).join('\n')} label="IOCs sugeridos" />
          </h4>
          <p className="dl-related-hint">
            Encontrados nas strings do arquivo; não entram no índice até constarem de um relatório
            publicado (use "Inserir IOCs sugeridos" no Novo relatório).
          </p>
          <ul className="dl-ioc-list">
            {suggested.map((ioc) => (
              <li key={`${ioc.kind}:${ioc.value}`}>
                <span className="dl-ioc-list__kind">{IOC_KIND_LABELS[ioc.kind]}</span>
                <Link className="dl-link dl-mono" to={iocHref(ioc.kind, ioc.value)}>
                  {ioc.value}
                </Link>
                <span className="dl-ioc-list__source">strings</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HpsmSection>
  );
}
