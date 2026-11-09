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
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { CapaInfo, CapaRule, FlossString } from '../api/types';
import { attackHref, AttackTechniqueLinks } from './attack';
import { CopyButton } from './CopyButton';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

/** Primeiro nivel do namespace das regras do capa, em portugues. */
const NAMESPACES: Record<string, string> = {
  'anti-analysis': 'Antianálise',
  collection: 'Coleta',
  communication: 'Comunicação',
  compiler: 'Compilador',
  'data-manipulation': 'Manipulação de dados',
  executable: 'Executável',
  exploitation: 'Exploração',
  'host-interaction': 'Interação com o sistema',
  impact: 'Impacto',
  linking: 'Ligação',
  'load-code': 'Carga de código',
  'malware-family': 'Família de malware',
  persistence: 'Persistência',
  runtime: 'Runtime',
  targeting: 'Alvo',
  nursery: 'Em teste (nursery)',
};
/**
 * Capacidades que pesam na triagem, em destaque (prefixo do namespace). Grupos inteiros como
 * load-code tambem tem o que todo executavel faz (parse PE header), entao ali so os ramos de risco.
 */
const RISKY = [
  'anti-analysis',
  'collection',
  'communication',
  'impact',
  'persistence',
  'exploitation',
  'malware-family',
  'load-code/shellcode',
  'load-code/dotnet',
  'host-interaction/process/inject',
];
const risky = (namespace: string) =>
  RISKY.some((prefix) => namespace === prefix || namespace.startsWith(`${prefix}/`));

/**
 * Analise de funcoes da amostra (GET /api/entries/:id/capa). Atualiza a cada 5 s enquanto esta
 * na fila ou analisando; a pagina usa a mesma consulta para as sugestoes do relatorio.
 */
export function useCapa(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['capa', entryId],
    queryFn: () => api.get<CapaInfo>(`/entries/${entryId}/capa`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.analysis?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(info: CapaInfo): { tone: StatusTone; text: string } {
  const a = info.analysis!;
  if (a.status === 'PENDING') {
    const retry = a.attempts > 0 && a.error ? ` (nova tentativa: ${a.error})` : '';
    return {
      tone: 'blue',
      text: `Na fila${a.ahead ? `, ${a.ahead} antes desta` : ''}${retry}`,
    };
  }
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: `Analisando desde ${fmtDate(a.startedAt)}` };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: `Falhou: ${a.error ?? 'erro desconhecido'}` };
  return { tone: 'green', text: `Concluída em ${fmtDate(a.finishedAt)}` };
}

/** Rotulo do grupo da regra (primeiro nivel do namespace). */
export function namespaceGroup(namespace: string): string {
  const top = namespace.split('/')[0] ?? '';
  return NAMESPACES[top] ?? (top || 'Outros');
}

function RuleRow({ rule }: { rule: CapaRule }) {
  return (
    <TableRow>
      <TableCell>
        {risky(rule.namespace) ? <StatusText tone="orange">{rule.name}</StatusText> : rule.name}
        {rule.mbc.length > 0 && <div className="dl-capa-mbc">{rule.mbc.join(' · ')}</div>}
      </TableCell>
      <TableCell>
        <span title={rule.namespace}>{namespaceGroup(rule.namespace)}</span>
      </TableCell>
      <TableCell>
        {rule.attack.length
          ? rule.attack.map((id) => (
              <Link key={id} className="dl-link dl-mono dl-capa-attack" to={attackHref(id)}>
                {id}
              </Link>
            ))
          : '—'}
      </TableCell>
      <TableCell>
        <span title={rule.addresses.join('\n')}>
          {rule.addresses.length ? rule.matches : 'arquivo'}
        </span>
      </TableCell>
    </TableRow>
  );
}

function FlossList({ title, items }: { title: string; items: FlossString[] }) {
  return (
    <details className="dl-static-strings" open={items.length > 0}>
      <summary>
        {title} ({items.length})
      </summary>
      {items.length ? (
        <ul>
          {items.map((s, i) => (
            <li key={`${s.string}-${i}`}>
              <code>{s.string}</code>
              {s.function && <span className="dl-hint-muted"> · função {s.function}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dl-static-empty">Nenhuma.</p>
      )}
    </details>
  );
}

/**
 * Secao "Analise de funcoes (capa)" da aba Detalhes (item 7.2): so executaveis do Windows e do
 * Linux. Roda sozinha depois do envio; analistas pedem de novo.
 */
export function CapaSection({
  entryId,
  canTriage,
  purged,
}: {
  entryId: string;
  canTriage: boolean;
  purged: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useCapa(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.eligible && !info.analysis)) return null;
  const a = info.analysis;

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/capa`, {});
      await queryClient.invalidateQueries({ queryKey: ['capa', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = a?.status === 'PENDING' || a?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.eligible && !purged && !busy ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? 'Pedindo...' : a ? 'Analisar de novo' : 'Analisar funções'}
      </button>
    ) : null;

  if (!a) {
    return (
      <HpsmSection title="Análise de funções (capa)">
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled
            ? 'Esta amostra ainda não teve as funções analisadas.'
            : 'A análise de funções está desligada (CAPA_URL vazio).'}{' '}
          {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(info);
  const rules = a.capa?.rules ?? [];
  const floss = a.floss;
  const suggested = a.iocCandidates ?? [];
  return (
    <HpsmSection title="Análise de funções (capa)">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField
          label="Situação"
          help="O capa diz o que cada função faz; o FLOSS recupera as strings que só aparecem na execução. Nada é executado."
        >
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Executável">
          <HpsmReadonly>
            {a.capa
              ? `${[a.capa.format, a.capa.arch, a.capa.os].filter(Boolean).join(' · ')} · ${
                  a.capa.functions ?? '?'
                } função(ões), ${a.capa.libraryFunctions ?? 0} de biblioteca`
              : '—'}
          </HpsmReadonly>
        </HpsmField>
        {a.status === 'DONE' && (
          <HpsmField label="Ferramentas">
            <HpsmReadonly>
              capa {a.versions?.capa ?? '?'} · regras {a.versions?.rules ?? '?'} · FLOSS{' '}
              {a.versions?.floss ?? '?'}
              {a.ms !== null && ` · ${Math.round(a.ms / 1000)} s`}
            </HpsmReadonly>
          </HpsmField>
        )}
        {(a.capaError || a.flossError) && a.status === 'DONE' && (
          <HpsmField label="Avisos">
            <HpsmReadonly>
              {[a.capaError && `capa: ${a.capaError}`, a.flossError && `FLOSS: ${a.flossError}`]
                .filter(Boolean)
                .join(' · ')}
            </HpsmReadonly>
          </HpsmField>
        )}
        {a.attack.length > 0 && (
          <HpsmField
            label="Técnicas ATT&CK"
            wide
            top
            help="Das regras do capa. Use “Inserir técnicas sugeridas” no Novo relatório."
          >
            <AttackTechniqueLinks ids={a.attack} />
          </HpsmField>
        )}
      </HpsmForm>

      {a.capa && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">
            Capacidades ({rules.length}
            {a.capa.truncated ? '+' : ''})
          </h4>
          {rules.length ? (
            <TableContainer>
              <Table size="xs" aria-label="Capacidades encontradas pelo capa">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Capacidade</TableHeader>
                    <TableHeader scope="col">Grupo</TableHeader>
                    <TableHeader scope="col">ATT&CK</TableHeader>
                    <TableHeader scope="col">Funções</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.map((rule) => (
                    <RuleRow key={rule.name} rule={rule} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <p className="dl-static-empty">Nenhuma regra do capa casou.</p>
          )}
        </div>
      )}

      {floss && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">Strings escondidas (FLOSS)</h4>
          <p className="dl-related-hint">
            Montadas caractere por caractere ou decifradas em tempo de execução: a extração comum de
            strings não as vê.
          </p>
          <FlossList title="Decifradas" items={floss.decoded} />
          <FlossList title="Montadas na pilha" items={floss.stack} />
          <FlossList title="Montadas na pilha, com laço (tight)" items={floss.tight} />
          {floss.truncated && <p className="dl-static-empty">Listas cortadas em 300.</p>}
        </div>
      )}

      {suggested.length > 0 && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">
            IOCs nas strings escondidas ({suggested.length}){' '}
            <CopyButton
              value={suggested.map((i) => i.value).join('\n')}
              label="IOCs das strings escondidas"
            />
          </h4>
          <ul className="dl-ioc-list">
            {suggested.map((ioc) => (
              <li key={`${ioc.kind}:${ioc.value}`}>
                <span className="dl-ioc-list__kind">{IOC_KIND_LABELS[ioc.kind]}</span>
                <Link className="dl-link dl-mono" to={iocHref(ioc.kind, ioc.value)}>
                  {ioc.value}
                </Link>
                <span className="dl-ioc-list__source">FLOSS</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HpsmSection>
  );
}
