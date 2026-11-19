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
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import {
  EffectivenessCells,
  EffectivenessHeaders,
  NeverFiredFilter,
  type RuleEffectiveness,
  useRuleEffectiveness,
} from '../components/RuleEffectiveness';
import { PriorityTag, StatusText } from '../components/tags';
import { localized } from '../i18n';
import { t as tr } from '../i18n/detection';

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
  | 'LNK'
  | 'LOOKALIKE'
  | 'CAPA_CAPABILITY'
  | 'ATTACK_TECHNIQUE'
  | 'SIGNATURE_INVALID'
  | 'PACKED'
  | 'PE_ALERT'
  | 'HIDDEN_IOC'
  | 'DIE_DETECTION'
  | 'MAGIKA';

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
  effectiveness?: RuleEffectiveness;
}

/** Condicoes: rotulo e o valor (obrigatorio, opcional ou nenhum) com a dica. */
const CONDITIONS: Record<
  Condition,
  { label: string; value?: { required: boolean; hint: string } }
> = localized(() => ({
  DETECTED_TYPE: {
    label: tr('cDetectedType'),
    value: { required: true, hint: tr('cDetectedTypeHint') },
  },
  YARA: {
    label: tr('cYara'),
    value: { required: false, hint: tr('cYaraHint') },
  },
  ANTIVIRUS: {
    label: tr('cAv'),
    value: { required: false, hint: tr('cAvHint') },
  },
  DOMAIN: {
    label: tr('cDomain'),
    value: { required: true, hint: tr('cDomainHint') },
  },
  SENDER: { label: tr('cSender'), value: { required: true, hint: tr('cSenderHint') } },
  MACRO: { label: tr('cMacro') },
  DISGUISED: { label: tr('cDisguised') },
  SCRIPT_RISK: { label: tr('cScriptHigh') },
  DOCUMENT_RISK: { label: tr('cDocHigh') },
  LNK: { label: tr('cLnk') },
  LOOKALIKE: {
    label: tr('cLookalike'),
    value: { required: false, hint: tr('cLookalikeHint') },
  },
  // Item 7.4: analise do executavel (7.1) e de funcoes, capa e FLOSS (7.2).
  CAPA_CAPABILITY: {
    label: tr('cCapa'),
    value: {
      required: false,
      hint: tr('cCapaHint'),
    },
  },
  ATTACK_TECHNIQUE: {
    label: tr('cAttack'),
    value: { required: true, hint: tr('cAttackHint') },
  },
  SIGNATURE_INVALID: { label: tr('cSigBad') },
  PACKED: {
    label: tr('cPacked'),
    value: { required: false, hint: tr('cPackedHint') },
  },
  PE_ALERT: {
    label: tr('cPeAlert'),
    value: {
      required: false,
      hint: tr('cPeAlertHint'),
    },
  },
  HIDDEN_IOC: {
    label: tr('cFloss'),
    value: { required: false, hint: tr('cFlossHint') },
  },
  // Item 7.9.
  DIE_DETECTION: {
    label: tr('cDie'),
    value: {
      required: false,
      hint: tr('cDieHint'),
    },
  },
  // Item 22.
  MAGIKA: {
    label: tr('cMagika'),
    value: { required: false, hint: tr('cMagikaHint') },
  },
}));

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
    queryFn: () => api.get<{ rules: TriageRule[]; effectivenessDays?: number }>('/triage-rules'),
  });
  const rules = query.data?.rules ?? [];
  // Eficacia (plano pos-revisao, item 2.3): ordenar por disparos e ver as que nunca dispararam.
  const days = query.data?.effectivenessDays ?? 90;
  const effectiveness = useRuleEffectiveness(rules);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const valueSpec = CONDITIONS[form.condition].value;
  const check = useRequiredFields([
    {
      id: 'rule-name',
      label: tr('nameRange'),
      ok: form.name.trim().length >= 3,
      api: 'name',
      value: form.name,
    },
    {
      id: 'rule-value',
      label: tr('value'),
      ok: !valueSpec?.required || form.value.trim().length > 0,
      api: 'value',
      value: form.value,
    },
    {
      id: 'rule-tags',
      label: tr('tagsOrPriority'),
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
      return tr('ruleAdded', { name: form.name.trim() });
    });
  };

  const toggle = (r: TriageRule) =>
    run(async () => {
      await api.patch(`/triage-rules/${r.id}`, { enabled: !r.enabled });
      return tr(r.enabled ? 'ruleOff' : 'ruleOn', { name: r.name });
    });

  const remove = async (r: TriageRule) => {
    const ok = await confirm({
      title: tr('deleteRule'),
      message: tr('deleteRuleConfirm', { name: r.name }),
      confirmLabel: tr('delete'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/triage-rules/${r.id}`);
      return tr('ruleDeleted', { name: r.name });
    });
  };

  return (
    <>
      <PageHeader title={tr('triageTitle')} subtitle={tr('triageSubtitle')} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={tr('loadingRules')} />}

      <HpsmSection title={tr('rulesN', { n: rules.length })}>
        {rules.length === 0 ? (
          <p className="dl-static-empty">{tr('noRulesManual')}</p>
        ) : (
          <>
            <NeverFiredFilter
              id="triage-never-fired"
              days={days}
              checked={effectiveness.neverOnly}
              count={effectiveness.never}
              onChange={effectiveness.setNeverOnly}
            />
            <TableContainer>
              <Table size="xs" aria-label={tr('triageTitle')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{tr('name')}</TableHeader>
                    <TableHeader scope="col">{tr('when')}</TableHeader>
                    <TableHeader scope="col">{tr('tags')}</TableHeader>
                    <TableHeader scope="col">{tr('priority')}</TableHeader>
                    <TableHeader scope="col">{tr('situation')}</TableHeader>
                    <EffectivenessHeaders
                      days={days}
                      sort={effectiveness.sort}
                      onSort={effectiveness.toggle}
                    />
                    <TableHeader scope="col">{tr('actions')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {effectiveness.rows.map((r) => (
                    <TableRow key={r.id} className={r.enabled ? undefined : 'is-off'}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.label}</TableCell>
                      <TableCell>{r.tags.join(', ') || '—'}</TableCell>
                      <TableCell>
                        {r.priority ? <PriorityTag priority={r.priority} /> : tr('keeps')}
                      </TableCell>
                      <TableCell>
                        <StatusText tone={r.enabled ? 'green' : 'gray'}>
                          {r.enabled ? tr('on') : tr('off')}
                        </StatusText>
                      </TableCell>
                      <EffectivenessCells value={r.effectiveness} />
                      <TableCell>
                        <span className="dl-row-actions">
                          <button
                            type="button"
                            className="dl-link-button"
                            disabled={busy}
                            onClick={() => void toggle(r)}
                          >
                            {r.enabled ? tr('turnOff') : tr('turnOn')}
                          </button>
                          <button
                            type="button"
                            className="dl-link-button"
                            disabled={busy}
                            onClick={() => void remove(r)}
                          >
                            {tr('delete')}
                          </button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </HpsmSection>

      <HpsmSection title={tr('newRule')}>
        <HpsmToolbar label={tr('newRuleActions')}>
          <HpsmToolbarButton
            label={tr('addRule')}
            icon={IconAdd}
            disabled={busy}
            onClick={() => void add()}
          />
        </HpsmToolbar>
        <HpsmForm columns={2}>
          <HpsmField
            label={tr('name')}
            htmlFor="rule-name"
            required
            invalid={check.isInvalid('rule-name')}
          >
            <TextInput
              id="rule-name"
              labelText={tr('name')}
              hideLabel
              maxLength={80}
              placeholder={tr('namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label={tr('when')} htmlFor="rule-condition">
            <Select
              id="rule-condition"
              labelText={tr('when')}
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
              label={tr('value')}
              htmlFor="rule-value"
              required={valueSpec.required}
              help={valueSpec.hint}
              invalid={check.isInvalid('rule-value')}
            >
              <TextInput
                id="rule-value"
                labelText={tr('value')}
                hideLabel
                maxLength={200}
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </HpsmField>
          )}
          <HpsmField
            label={tr('addTags')}
            htmlFor="rule-tags"
            help={tr('addTagsHelp')}
            invalid={check.isInvalid('rule-tags')}
          >
            <TextInput
              id="rule-tags"
              labelText={tr('addTags')}
              hideLabel
              placeholder={tr('tagsPlaceholder')}
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label={tr('raisePriority')} htmlFor="rule-priority" help={tr('raiseHelp')}>
            <Select
              id="rule-priority"
              labelText={tr('raisePriority')}
              hideLabel
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              <SelectItem value="" text={tr('keep')} />
              <SelectItem value="P1" text={tr('p1')} />
              <SelectItem value="P2" text={tr('p2')} />
              <SelectItem value="P3" text={tr('p3')} />
            </Select>
          </HpsmField>
        </HpsmForm>
      </HpsmSection>
    </>
  );
}
