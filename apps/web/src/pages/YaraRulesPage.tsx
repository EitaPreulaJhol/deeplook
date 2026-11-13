import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, apiFieldErrors } from '../api/client';
import type { YaraRule } from '../api/types';
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
import { useSaveShortcut } from '../components/shortcuts';
import { StatusText } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { YaraPacksSection } from '../components/YaraPacksSection';
import { useRetroscans, YaraRetroscans } from '../components/YaraRetroscans';
import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

// Funcao: o exemplo acompanha o idioma (nome e descricao da regra).
const SAMPLE = () => `rule ${t('sampleRuleName')} : dropper
{
  meta:
    description = "${t('sampleRuleDesc')}"
  strings:
    $s1 = "dropper.exe" nocase
    $s2 = { 6A 40 68 00 30 00 00 }
  condition:
    uint16(0) == 0x5A4D and any of them
}`;

const EMPTY = { name: '', description: '', source: '', enabled: true };

/** Saida do compilador (erros ou avisos), com a linha e a coluna. */
interface CompilerOutput {
  ok: boolean;
  lines: string[];
}

/**
 * Regras YARA (item 56; analistas e admins): conjuntos de regras aplicados a
 * cada arquivo enviado. A API compila com o YARA-X antes de salvar; regra com
 * erro nunca entra em uso.
 */
export function YaraRulesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['yara-rules'],
    queryFn: () =>
      api.get<{
        rules: (YaraRule & { effectiveness?: RuleEffectiveness })[];
        effectivenessDays?: number;
      }>('/yara/rules'),
  });
  const rules = query.data?.rules ?? [];
  // Eficacia (plano pos-revisao, item 2.3): ordenar por disparos e ver as que nunca dispararam.
  const days = query.data?.effectivenessDays ?? 90;
  const effectiveness = useRuleEffectiveness(rules);
  const active = rules.filter((r) => r.enabled).length;

  const [editing, setEditing] = useState<YaraRule | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [output, setOutput] = useState<CompilerOutput | null>(null);

  const original = editing
    ? {
        name: editing.name,
        description: editing.description ?? '',
        source: editing.source,
        enabled: editing.enabled,
      }
    : EMPTY;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const { allowNavigation } = useUnsavedChanges(dirty);

  const check = useRequiredFields([
    {
      id: 'yara-name',
      label: t('nameRange2'),
      ok: form.name.trim().length >= 2 && form.name.trim().length <= 80,
      api: 'name',
      value: form.name,
    },
    {
      id: 'yara-source',
      label: t('rule'),
      ok: form.source.trim().length >= 10,
      api: 'source',
      value: form.source,
    },
  ]);

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setOutput(null);
    check.reset();
  };
  const startEdit = (rule: YaraRule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      description: rule.description ?? '',
      source: rule.source,
      enabled: rule.enabled,
    });
    setOutput(null);
    check.reset();
    setNotice(null);
  };

  /** Erros do compilador ficam no quadro abaixo do editor (com a linha). */
  const compileErrors = (err: unknown): boolean => {
    const source = apiFieldErrors(err)?.source;
    if (!source?.length || !/error/i.test(source[0])) return false;
    setOutput({ ok: false, lines: source });
    check.fromApi(err);
    return true;
  };

  const validate = async () => {
    setNotice(null);
    if (!form.source.trim()) {
      check.check();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; errors: string[]; warnings: string[] }>(
        '/yara/validate',
        { source: form.source },
      );
      setOutput(
        res.ok
          ? { ok: true, lines: res.warnings.length ? res.warnings : [t('compilesOk')] }
          : { ok: false, lines: res.errors },
      );
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setNotice(null);
    setOutput(null);
    if (!check.check()) return;
    setBusy(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        source: form.source,
        enabled: form.enabled,
      };
      const res = editing
        ? await api.patch<{ rule: YaraRule; warnings: string[] }>(`/yara/rules/${editing.id}`, body)
        : await api.post<{ rule: YaraRule; warnings: string[] }>('/yara/rules', body);
      await queryClient.invalidateQueries({ queryKey: ['yara-rules'] });
      setNotice({
        ok: true,
        text: t(res.rule.enabled ? 'yaraSavedOn' : 'yaraSavedOff', { name: res.rule.name }),
      });
      allowNavigation();
      startNew();
      if (res.warnings.length) setOutput({ ok: true, lines: res.warnings });
    } catch (err) {
      if (!compileErrors(err) && !check.fromApi(err)) {
        setNotice({ ok: false, text: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule: YaraRule) => {
    setNotice(null);
    try {
      await api.patch(`/yara/rules/${rule.id}`, { enabled: !rule.enabled });
      await queryClient.invalidateQueries({ queryKey: ['yara-rules'] });
      setNotice({
        ok: true,
        text: t(rule.enabled ? 'yaraDisabled' : 'yaraEnabled', { name: rule.name }),
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  // YARA retroativo (item 67): aplica a regra as amostras ja guardadas.
  const retro = useRetroscans();
  const retroRunning = retro.data?.items.some((r) => r.status === 'RUNNING') ?? false;
  const startRetro = async (rule: Pick<YaraRule, 'id' | 'name'>) => {
    const ok = await confirm({
      title: t('applyExisting'),
      message: t('applyExistingConfirm', { name: rule.name }),
      confirmLabel: t('apply'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    setNotice(null);
    try {
      const res = await api.post<{ retroscan: { total: number } }>(
        `/yara/rules/${rule.id}/retroscan`,
        {},
      );
      await queryClient.invalidateQueries({ queryKey: ['yara-retroscans'] });
      setNotice({
        ok: true,
        text: t('retroStarted', {
          name: rule.name,
          n: res.retroscan.total.toLocaleString(intlLocale()),
        }),
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  const remove = async (rule: YaraRule) => {
    const ok = await confirm({
      title: t('deleteRule'),
      message: t('deleteYaraConfirm', { name: rule.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/yara/rules/${rule.id}`);
      await queryClient.invalidateQueries({ queryKey: ['yara-rules'] });
      if (editing?.id === rule.id) startNew();
      setNotice({ ok: true, text: t('ruleDeleted', { name: rule.name }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  useSaveShortcut(save, !busy);

  return (
    <>
      <HpsmToolbar label={t('ruleActions')}>
        <HpsmToolbarButton
          label={busy ? t('saving') : t('saveRule')}
          title={t('saveHint')}
          icon={IconAdd}
          disabled={busy}
          onClick={save}
        />
        <HpsmToolbarButton label={t('validate')} disabled={busy} onClick={() => void validate()} />
        {editing && <HpsmToolbarButton label={t('cancelEdit')} onClick={startNew} />}
      </HpsmToolbar>
      <PageHeader
        title={t('yaraTitle')}
        subtitle={t(active === 1 ? 'yaraSubtitleOne' : 'yaraSubtitleMany', { n: active })}
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && !output && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title={editing ? t('editRule', { name: editing.name }) : t('newRule')}>
        <HpsmForm columns={2}>
          <HpsmField
            label={t('name')}
            htmlFor="yara-name"
            required
            invalid={check.isInvalid('yara-name')}
          >
            <TextInput
              id="yara-name"
              labelText={t('name')}
              hideLabel
              placeholder={t('yaraNamePlaceholder')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label={t('active')} htmlFor="yara-enabled">
            <Checkbox
              id="yara-enabled"
              labelText={t('applyNext')}
              checked={form.enabled}
              onChange={(_, { checked }) => setForm((f) => ({ ...f, enabled: checked }))}
            />
          </HpsmField>
          <HpsmField label={t('description')} htmlFor="yara-description" wide>
            <TextInput
              id="yara-description"
              labelText={t('description')}
              hideLabel
              placeholder={t('descPlaceholder')}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </HpsmField>
          <HpsmField
            label={t('rule')}
            htmlFor="yara-source"
            required
            wide
            top
            invalid={check.isInvalid('yara-source')}
            help={t('ruleHelp')}
          >
            <TextArea
              id="yara-source"
              className="dl-code-input"
              labelText={t('rule')}
              hideLabel
              rows={14}
              spellCheck={false}
              placeholder={SAMPLE()}
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
        {output && (
          <div className="dl-compiler-output" data-ok={output.ok} role="status">
            <strong>{output.ok ? t('compilerOk') : t('compilerError')}</strong>
            <pre>{output.lines.join('\n\n')}</pre>
          </div>
        )}
      </HpsmSection>

      {query.isLoading && <HpsmLoading text={t('loadingRules2')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && rules.length === 0 && (
        <HpsmMessage kind="info">{t('noTeamRules')}</HpsmMessage>
      )}
      {rules.length > 0 && (
        <>
          <div className="dl-mt-lg">
            <NeverFiredFilter
              id="yara-never-fired"
              days={days}
              checked={effectiveness.neverOnly}
              count={effectiveness.never}
              onChange={effectiveness.setNeverOnly}
            />
          </div>
          <TableContainer>
            <Table size="xs" aria-label={t('yaraTitle')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('name')}</TableHeader>
                  <TableHeader scope="col">{t('situation')}</TableHeader>
                  <TableHeader scope="col">{t('description')}</TableHeader>
                  <EffectivenessHeaders
                    days={days}
                    sort={effectiveness.sort}
                    onSort={effectiveness.toggle}
                  />
                  <TableHeader scope="col">{t('changedBy')}</TableHeader>
                  <TableHeader scope="col">{t('updatedAt')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {effectiveness.rows.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={editing?.id === rule.id ? 'is-selected' : undefined}
                  >
                    <TableCell>{rule.name}</TableCell>
                    <TableCell>
                      <StatusText tone={rule.enabled ? 'green' : 'gray'}>
                        {rule.enabled ? t('active') : t('disabledF')}
                      </StatusText>
                    </TableCell>
                    <TableCell>{rule.description ?? '—'}</TableCell>
                    <EffectivenessCells value={rule.effectiveness} />
                    <TableCell>{rule.updatedBy?.displayName ?? '—'}</TableCell>
                    <TableCell>{fmtDate(rule.updatedAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" kind="tertiary" onClick={() => startEdit(rule)}>
                        {t('edit')}
                      </Button>{' '}
                      <Button size="sm" kind="tertiary" onClick={() => void toggle(rule)}>
                        {rule.enabled ? t('disable') : t('enable')}
                      </Button>{' '}
                      <Button
                        size="sm"
                        kind="tertiary"
                        disabled={retroRunning}
                        title={retroRunning ? t('retroRunning') : t('retroHelp')}
                        onClick={() => void startRetro(rule)}
                      >
                        {t('applyExistingEllipsis')}
                      </Button>{' '}
                      <Button
                        size="sm"
                        kind="danger--tertiary"
                        aria-label={t('deleteRuleNamed', { name: rule.name })}
                        onClick={() => void remove(rule)}
                      >
                        {t('delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <YaraPacksSection
        retroRunning={retroRunning}
        onRetro={(rule) => void startRetro(rule)}
        onNotice={setNotice}
      />

      <YaraRetroscans onNotice={setNotice} />
    </>
  );
}
