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
  TextArea,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Broadcast } from '../components/BroadcastBanner';
import type { CaseSummary } from '../components/cases';
import { useConfirm } from '../components/HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/tags';
import { intlLocale } from '../i18n';

type Row = Broadcast & { active: boolean; _count: { dismissals: number } };

const DURATIONS = [
  { value: '4', text: '4 horas' },
  { value: '24', text: '1 dia' },
  { value: '72', text: '3 dias' },
  { value: '168', text: '1 semana' },
  { value: '720', text: '30 dias' },
];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Avisos gerais (item 88): analistas publicam um aviso para todos, com nivel,
 * validade e caso opcional; no maximo 3 ativos. "Encerrar" tira da faixa na hora.
 */
export function BroadcastsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['broadcasts', 'all'],
    queryFn: () => api.get<{ items: Row[] }>('/broadcasts'),
  });
  const casesQuery = useQuery({
    queryKey: ['cases', 'active-for-broadcast'],
    queryFn: () => api.get<{ items: CaseSummary[] }>('/cases?status=active&limit=100'),
  });
  const items = query.data?.items ?? [];
  const active = items.filter((b) => b.active);
  const [form, setForm] = useState({ text: '', level: 'INFO', hours: '24', caseId: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const check = useRequiredFields([
    {
      id: 'broadcast-text',
      label: 'Texto (5 a 300 caracteres)',
      ok: form.text.trim().length >= 5,
      api: 'text',
      value: form.text,
    },
  ]);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      setNotice({ ok: true, text });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!check.check()) return;
    void run(async () => {
      await api.post('/broadcasts', {
        text: form.text,
        level: form.level,
        hours: Number(form.hours),
        caseId: form.caseId || null,
      });
      setForm({ text: '', level: 'INFO', hours: '24', caseId: '' });
      check.reset();
      return 'Aviso publicado: já aparece no topo para todos.';
    });
  };

  const end = async (b: Row) => {
    const ok = await confirm({
      title: 'Encerrar aviso',
      message: `Encerrar agora o aviso "${b.text}"? Ele sai da faixa de todos.`,
      confirmLabel: 'Encerrar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.post(`/broadcasts/${b.id}/end`);
      return 'Aviso encerrado.';
    });
  };

  return (
    <>
      <PageHeader
        title="Avisos gerais"
        subtitle="Avisos da equipe para todos os usuários, numa faixa no topo e na Página Inicial, até vencer ou a pessoa dispensar. No máximo 3 ativos."
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title="Novo aviso">
        {active.length >= 3 ? (
          <p className="dl-static-empty">Já há 3 avisos ativos. Encerre um para publicar outro.</p>
        ) : (
          <HpsmForm columns={2}>
            <HpsmField
              label="Texto"
              htmlFor="broadcast-text"
              required
              wide
              top
              invalid={check.isInvalid('broadcast-text')}
            >
              <TextArea
                id="broadcast-text"
                labelText="Texto"
                hideLabel
                rows={2}
                maxLength={300}
                placeholder="ex.: Campanha de phishing do “boleto vencido” em andamento. Não abra anexos de cobrança."
                value={form.text}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              />
            </HpsmField>
            <HpsmField label="Nível" htmlFor="broadcast-level">
              <Select
                id="broadcast-level"
                labelText="Nível"
                hideLabel
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
              >
                <SelectItem value="INFO" text="Informação" />
                <SelectItem value="WARNING" text="Alerta" />
              </Select>
            </HpsmField>
            <HpsmField label="Vale por" htmlFor="broadcast-hours">
              <Select
                id="broadcast-hours"
                labelText="Vale por"
                hideLabel
                value={form.hours}
                onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
              >
                {DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value} text={d.text} />
                ))}
              </Select>
            </HpsmField>
            <HpsmField label="Caso (opcional)" htmlFor="broadcast-case">
              <Select
                id="broadcast-case"
                labelText="Caso"
                hideLabel
                value={form.caseId}
                onChange={(e) => setForm((f) => ({ ...f, caseId: e.target.value }))}
              >
                <SelectItem value="" text="— Nenhum —" />
                {(casesQuery.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id} text={`${c.code} · ${c.title}`} />
                ))}
              </Select>
            </HpsmField>
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={publish}
              >
                Publicar aviso
              </button>
            </HpsmFormActions>
          </HpsmForm>
        )}
      </HpsmSection>

      <HpsmSection title={`Avisos (${items.length})`} className="dl-mt-lg">
        {query.isLoading && <HpsmLoading text="Carregando avisos..." />}
        {items.length === 0 && !query.isLoading ? (
          <p className="dl-static-empty">Nenhum aviso nos últimos 30 dias.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Avisos gerais">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Aviso</TableHeader>
                  <TableHeader scope="col">Nível</TableHeader>
                  <TableHeader scope="col">Por</TableHeader>
                  <TableHeader scope="col">Vale até</TableHeader>
                  <TableHeader scope="col">Dispensado por</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id} className={b.active ? undefined : 'is-off'}>
                    <TableCell>
                      {b.text}
                      {b.case && (
                        <>
                          {' '}
                          <Link className="dl-link" to={`/casos/${b.case.id}`}>
                            ({b.case.code})
                          </Link>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={b.level === 'WARNING' ? 'orange' : 'blue'}>
                        {b.level === 'WARNING' ? 'Alerta' : 'Informação'}
                      </StatusText>
                    </TableCell>
                    <TableCell>{b.createdBy?.displayName ?? '—'}</TableCell>
                    <TableCell>
                      {fmt(b.expiresAt)}
                      {!b.active && ' (encerrado)'}
                    </TableCell>
                    <TableCell>{b._count.dismissals} pessoa(s)</TableCell>
                    <TableCell>
                      {b.active && (
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void end(b)}
                        >
                          Encerrar
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
