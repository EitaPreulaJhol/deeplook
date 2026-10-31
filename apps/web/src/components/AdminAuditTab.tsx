import {
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { AuditAction, AuditEvent } from '../api/types';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const PAGE_SIZE = 50;

/** Rotulos e cores das acoes (o CSV usa os mesmos rotulos, no backend). */
export const AUDIT_ACTIONS: Record<AuditAction, { label: string; tone: StatusTone }> = {
  USER_REGISTERED: { label: 'Cadastro com chave', tone: 'green' },
  USER_ROLE_CHANGED: { label: 'Papel alterado', tone: 'blue' },
  USER_SUSPENDED: { label: 'Conta suspensa', tone: 'orange' },
  USER_REACTIVATED: { label: 'Conta reativada', tone: 'green' },
  USER_PASSWORD_RESET: { label: 'Senha redefinida pelo admin', tone: 'orange' },
  USER_PASSWORD_CHANGED: { label: 'Senha alterada pelo usuário', tone: 'blue' },
  KEY_CREATED: { label: 'Chave gerada', tone: 'blue' },
  KEY_REVOKED: { label: 'Chave revogada', tone: 'orange' },
  TEMPLATE_CREATED: { label: 'Modelo criado', tone: 'gray' },
  TEMPLATE_UPDATED: { label: 'Modelo alterado', tone: 'gray' },
  TEMPLATE_DELETED: { label: 'Modelo excluído', tone: 'gray' },
  LOGIN_FAILED: { label: 'Login recusado', tone: 'orange' },
  LOGIN_LOCKED: { label: 'Login bloqueado (tentativas)', tone: 'red' },
  API_ACCESS_GRANTED: { label: 'Acesso por API liberado', tone: 'blue' },
  API_ACCESS_REVOKED: { label: 'Acesso por API retirado', tone: 'orange' },
  API_TOKEN_CREATED: { label: 'Token de API gerado', tone: 'blue' },
  API_TOKEN_REVOKED: { label: 'Token de API revogado', tone: 'orange' },
  SESSION_REVOKED: { label: 'Sessão encerrada', tone: 'orange' },
  TWO_FACTOR_ENABLED: { label: '2FA ativado', tone: 'green' },
  TWO_FACTOR_DISABLED: { label: '2FA desativado', tone: 'orange' },
  TWO_FACTOR_RECOVERY_CODES: { label: 'Códigos de recuperação gerados', tone: 'blue' },
  TWO_FACTOR_RECOVERY_USED: { label: 'Login com código de recuperação', tone: 'orange' },
  ENTRY_TRASHED: { label: 'Amostra movida para a lixeira', tone: 'orange' },
  ENTRY_RESTORED: { label: 'Amostra restaurada', tone: 'green' },
  ENTRY_DELETED: { label: 'Amostra excluída definitivamente', tone: 'red' },
  ENTRY_DOWNLOADED: { label: 'Amostra baixada', tone: 'orange' },
  YARA_RULE_CREATED: { label: 'Regra YARA criada', tone: 'gray' },
  YARA_RULE_UPDATED: { label: 'Regra YARA alterada', tone: 'gray' },
  YARA_RULE_DELETED: { label: 'Regra YARA excluída', tone: 'gray' },
  ALLOWLIST_ADDED: { label: 'Indicador permitido incluído', tone: 'gray' },
  ALLOWLIST_REMOVED: { label: 'Indicador permitido removido', tone: 'gray' },
  ALLOWLIST_IMPORTED: { label: 'Indicadores permitidos importados', tone: 'gray' },
  BACKUP_CREATED: { label: 'Backup gerado', tone: 'blue' },
  BACKUP_DOWNLOADED: { label: 'Backup baixado', tone: 'orange' },
  BACKUP_DELETED: { label: 'Backup excluído', tone: 'gray' },
  COMPANY_DOMAIN_ADDED: { label: 'Domínio da empresa incluído', tone: 'blue' },
  COMPANY_DOMAIN_REMOVED: { label: 'Domínio da empresa excluído', tone: 'orange' },
  TRIAGE_RULE_CHANGED: { label: 'Regra de triagem alterada', tone: 'blue' },
  ASSIGNMENT_CHANGED: { label: 'Atribuição automática alterada', tone: 'blue' },
  BROADCAST_PUBLISHED: { label: 'Aviso geral publicado', tone: 'blue' },
  BROADCAST_ENDED: { label: 'Aviso geral encerrado', tone: 'gray' },
};

const PERIODS = [
  { value: '1', text: 'Últimas 24 horas' },
  { value: '7', text: 'Últimos 7 dias' },
  { value: '30', text: 'Últimos 30 dias' },
  { value: '90', text: 'Últimos 90 dias' },
  { value: '', text: 'Todo o período' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Aba "Auditoria" da Administracao: quem mudou papeis, suspendeu contas,
 * redefiniu senhas, gerou ou revogou chaves, mexeu nos modelos de relatorio e
 * as tentativas de login recusadas ou bloqueadas. Somente leitura.
 */
export function AdminAuditTab() {
  const [action, setAction] = useState('');
  const [days, setDays] = useState('30');
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  // Busca com espera curta, como nas listas de amostras.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(draftQ.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [draftQ]);

  const filters = new URLSearchParams();
  if (action) filters.set('action', action);
  if (days) filters.set('days', days);
  if (q) filters.set('q', q);
  const params = new URLSearchParams(filters);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));

  const query = useQuery({
    queryKey: ['admin', 'audit', action, days, q, offset],
    queryFn: () =>
      api.get<{ total: number; items: AuditEvent[] }>(`/admin/audit?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const clear = () => {
    setAction('');
    setDays('30');
    setDraftQ('');
    setQ('');
    setOffset(0);
  };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + PAGE_SIZE, total);
  const lastOffset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);

  return (
    <>
      <HpsmFilterBar
        onClear={clear}
        exportHref={`/api/admin/audit/export.csv?${filters.toString()}`}
      >
        <HpsmFilterItem label="Buscar" htmlFor="audit-q">
          <TextInput
            id="audit-q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Quem, alvo, detalhe, IP..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label="Ação" htmlFor="audit-action">
          <Select
            id="audit-action"
            labelText="Ação"
            hideLabel
            size="sm"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            <SelectItem value="" text="Todas" />
            {(Object.keys(AUDIT_ACTIONS) as AuditAction[]).map((key) => (
              <SelectItem key={key} value={key} text={AUDIT_ACTIONS[key].label} />
            ))}
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Período" htmlFor="audit-days">
          <Select
            id="audit-days"
            labelText="Período"
            hideLabel
            size="sm"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setOffset(0);
            }}
          >
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value} text={p.text} />
            ))}
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando a auditoria..." />}
      {query.isError && (
        <HpsmMessage kind="error">
          Erro ao carregar a auditoria: {(query.error as Error).message}
        </HpsmMessage>
      )}
      {query.data && total === 0 && (
        <HpsmMessage kind="info">Nenhum registro de auditoria com esses filtros.</HpsmMessage>
      )}

      {query.data && (
        <>
          <TableContainer>
            <Table size="xs" aria-label="Auditoria">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Data</TableHeader>
                  <TableHeader scope="col">Quem</TableHeader>
                  <TableHeader scope="col">Ação</TableHeader>
                  <TableHeader scope="col">Alvo</TableHeader>
                  <TableHeader scope="col">Detalhe</TableHeader>
                  <TableHeader scope="col">IP</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="dl-audit__date">{fmtDate(event.createdAt)}</TableCell>
                    <TableCell>
                      {event.actor ? (
                        <span title={event.actor.email}>{event.actor.displayName}</span>
                      ) : (
                        <span className="dl-audit__anon">(anônimo)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={AUDIT_ACTIONS[event.action].tone}>
                        {AUDIT_ACTIONS[event.action].label}
                      </StatusText>
                    </TableCell>
                    <TableCell>
                      <span className="dl-mono">
                        {event.targetLabel ?? event.targetUser?.email ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>{event.detail ?? '—'}</TableCell>
                    <TableCell>
                      <span className="dl-mono">{event.ip ?? '—'}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <div className="dl-table-foot">
            <span>
              Exibindo registros {first} a {last} de {total}
            </span>
            <div className="hpsm-pager" role="group" aria-label="Paginação">
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Primeira página"
                aria-label="Primeira página"
                disabled={offset === 0}
                onClick={() => setOffset(0)}
              >
                «
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Página anterior"
                aria-label="Página anterior"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ‹ Anterior
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Próxima página"
                aria-label="Próxima página"
                disabled={last >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Próxima ›
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Última página"
                aria-label="Última página"
                disabled={last >= total}
                onClick={() => setOffset(lastOffset)}
              >
                »
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
