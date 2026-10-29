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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { Priority } from '../api/types';
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
import { PriorityTag, StatusText } from '../components/tags';

type Condition =
  | 'DETECTED_TYPE'
  | 'YARA'
  | 'ANTIVIRUS'
  | 'DOMAIN'
  | 'SENDER'
  | 'MACRO'
  | 'DISGUISED'
  | 'SCRIPT_RISK'
  | 'DOCUMENT_RISK'
  | 'LNK';

interface TriageRule {
  id: string;
  name: string;
  condition: Condition;
  value: string | null;
  tags: string[];
  priority: Priority | null;
  enabled: boolean;
  label: string;
  createdBy: { id: string; displayName: string } | null;
}

/** Condicoes: rotulo e o valor (obrigatorio, opcional ou nenhum) com a dica. */
const CONDITIONS: Record<
  Condition,
  { label: string; value?: { required: boolean; hint: string } }
> = {
  DETECTED_TYPE: {
    label: 'Tipo real é…',
    value: { required: true, hint: 'ex.: pe, ole, pdf, lnk, zip' },
  },
  YARA: {
    label: 'Regra YARA casou',
    value: { required: false, hint: 'nome da regra (vazio = qualquer)' },
  },
  ANTIVIRUS: {
    label: 'Antivírus detectou',
    value: { required: false, hint: 'parte da assinatura (vazio = qualquer)' },
  },
  DOMAIN: {
    label: 'Domínio do link',
    value: { required: true, hint: 'ex.: banco-falso.com ou .top' },
  },
  SENDER: { label: 'Remetente do e-mail', value: { required: true, hint: 'endereço ou domínio' } },
  MACRO: { label: 'Documento com macro' },
  DISGUISED: { label: 'Executável disfarçado (extensão)' },
  SCRIPT_RISK: { label: 'Script com risco alto' },
  DOCUMENT_RISK: { label: 'Documento com risco alto' },
  LNK: { label: 'Atalho (.lnk) suspeito' },
};

const EMPTY = { name: '', condition: 'MACRO' as Condition, value: '', tags: '', priority: '' };

/**
 * Regras de triagem (item 86): quando a analise achar algo, a amostra ganha
 * tags e, se for o caso, prioridade mais alta. Todas as regras que casarem
 * valem; nada e tirado nem rebaixado.
 */
export function TriageRulesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['triage-rules'],
    queryFn: () => api.get<{ rules: TriageRule[] }>('/triage-rules'),
  });
  const rules = query.data?.rules ?? [];
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const valueSpec = CONDITIONS[form.condition].value;
  const check = useRequiredFields([
    {
      id: 'rule-name',
      label: 'Nome (3 a 80 caracteres)',
      ok: form.name.trim().length >= 3,
      api: 'name',
      value: form.name,
    },
    {
      id: 'rule-value',
      label: 'Valor',
      ok: !valueSpec?.required || form.value.trim().length > 0,
      api: 'value',
      value: form.value,
    },
    {
      id: 'rule-tags',
      label: 'Tags ou prioridade',
      ok: form.tags.trim().length > 0 || form.priority !== '',
      api: 'tags',
      value: form.tags,
    },
  ]);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['triage-rules'] });
      setNotice({ ok: true, text });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!check.check()) return;
    void run(async () => {
      await api.post('/triage-rules', {
        name: form.name,
        condition: form.condition,
        value: valueSpec ? form.value || null : null,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        priority: form.priority || null,
      });
      setForm(EMPTY);
      check.reset();
      return `Regra "${form.name.trim()}" incluída. Vale para as próximas amostras.`;
    });
  };

  const toggle = (r: TriageRule) =>
    run(async () => {
      await api.patch(`/triage-rules/${r.id}`, { enabled: !r.enabled });
      return `Regra "${r.name}" ${r.enabled ? 'desligada' : 'ligada'}.`;
    });

  const remove = async (r: TriageRule) => {
    const ok = await confirm({
      title: 'Excluir regra',
      message: `Excluir a regra "${r.name}"? As tags já aplicadas continuam nas amostras.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/triage-rules/${r.id}`);
      return `Regra "${r.name}" excluída.`;
    });
  };

  return (
    <>
      <PageHeader
        title="Regras de triagem"
        subtitle="Quando a análise de uma amostra nova achar algo, ela ganha tags e, se for o caso, prioridade mais alta. Todas as regras que casarem valem; nada é tirado nem rebaixado. Regras de YARA e antivírus valem quando a varredura termina."
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text="Carregando as regras..." />}

      <HpsmSection title={`Regras (${rules.length})`}>
        {rules.length === 0 ? (
          <p className="dl-static-empty">Nenhuma regra: a triagem é toda manual.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Regras de triagem">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Nome</TableHeader>
                  <TableHeader scope="col">Quando</TableHeader>
                  <TableHeader scope="col">Tags</TableHeader>
                  <TableHeader scope="col">Prioridade</TableHeader>
                  <TableHeader scope="col">Situação</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id} className={r.enabled ? undefined : 'is-off'}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>{r.tags.join(', ') || '—'}</TableCell>
                    <TableCell>
                      {r.priority ? <PriorityTag priority={r.priority} /> : 'mantém'}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={r.enabled ? 'green' : 'gray'}>
                        {r.enabled ? 'Ligada' : 'Desligada'}
                      </StatusText>
                    </TableCell>
                    <TableCell>
                      <span className="dl-row-actions">
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void toggle(r)}
                        >
                          {r.enabled ? 'Desligar' : 'Ligar'}
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void remove(r)}
                        >
                          Excluir
                        </button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>

      <HpsmSection title="Nova regra" className="dl-mt-lg">
        <HpsmForm columns={2}>
          <HpsmField
            label="Nome"
            htmlFor="rule-name"
            required
            invalid={check.isInvalid('rule-name')}
          >
            <TextInput
              id="rule-name"
              labelText="Nome"
              hideLabel
              maxLength={80}
              placeholder="ex.: Documento com macro"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label="Quando" htmlFor="rule-condition">
            <Select
              id="rule-condition"
              labelText="Quando"
              hideLabel
              value={form.condition}
              onChange={(e) =>
                setForm((f) => ({ ...f, condition: e.target.value as Condition, value: '' }))
              }
            >
              {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
                <SelectItem key={c} value={c} text={CONDITIONS[c].label} />
              ))}
            </Select>
          </HpsmField>
          {valueSpec && (
            <HpsmField
              label="Valor"
              htmlFor="rule-value"
              required={valueSpec.required}
              help={valueSpec.hint}
              invalid={check.isInvalid('rule-value')}
            >
              <TextInput
                id="rule-value"
                labelText="Valor"
                hideLabel
                maxLength={200}
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </HpsmField>
          )}
          <HpsmField
            label="Incluir tags"
            htmlFor="rule-tags"
            help="Separadas por vírgula. Ou só a prioridade."
            invalid={check.isInvalid('rule-tags')}
          >
            <TextInput
              id="rule-tags"
              labelText="Incluir tags"
              hideLabel
              placeholder="ex.: macro, office"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            />
          </HpsmField>
          <HpsmField
            label="Subir a prioridade para"
            htmlFor="rule-priority"
            help="Só sobe; nunca rebaixa."
          >
            <Select
              id="rule-priority"
              labelText="Subir a prioridade para"
              hideLabel
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              <SelectItem value="" text="Manter" />
              <SelectItem value="P1" text="P1 Crítica" />
              <SelectItem value="P2" text="P2 Alta" />
              <SelectItem value="P3" text="P3 Média" />
            </Select>
          </HpsmField>
          <HpsmFormActions>
            <button type="button" className="dl-btn dl-btn--primary" disabled={busy} onClick={add}>
              Incluir regra
            </button>
          </HpsmFormActions>
        </HpsmForm>
      </HpsmSection>
    </>
  );
}
