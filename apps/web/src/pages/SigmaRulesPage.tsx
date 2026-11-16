import {
  Button,
  Checkbox,
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
  TextInput,
} from '@carbon/react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, apiFieldErrors } from '../api/client';
import type {
  CatalogSigmaRule,
  SigmaRuleSummary,
  SigmaTestResult,
  TeamSigmaRule,
} from '../api/types';
import { AttackTechniqueLinks } from '../components/attack';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { StatusText, type StatusTone } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';
import { t as ts } from '../i18n/sandbox';

const fmtDate = (iso: string) => new Date(iso).toLocaleString(intlLocale());
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

const LEVEL: Record<string, { key: Parameters<typeof ts>[0]; tone: StatusTone }> = {
  critical: { key: 'sigmaCritical', tone: 'red' },
  high: { key: 'sigmaHigh', tone: 'red' },
  medium: { key: 'sigmaMedium', tone: 'orange' },
  low: { key: 'sigmaLow', tone: 'blue' },
  informational: { key: 'sigmaInfo', tone: 'gray' },
};
function Level({ level }: { level: string }) {
  const l = LEVEL[level] ?? LEVEL.informational;
  return <StatusText tone={l.tone}>{ts(l.key)}</StatusText>;
}

/** Modelo de regra: o id novo a cada uso (o Sigma pede um UUID). */
const TEMPLATE = () => `title: ${t('sigmaTemplateTitle')}
id: ${crypto.randomUUID()}
status: experimental
description: ${t('sigmaTemplateDesc')}
level: high
logsource:
  product: windows
  category: process_creation
detection:
  selection:
    Image|endswith: '\\\\powershell.exe'
    CommandLine|contains|all:
      - '-enc'
      - 'hidden'
  condition: selection
tags:
  - attack.execution
  - attack.t1059.001
`;

const EMPTY = { source: '', enabled: true };

type Output = { ok: true; rule: SigmaRuleSummary } | { ok: false; lines: string[] };

const summaryLine = (r: SigmaRuleSummary) =>
  t('sigmaCompiles', {
    title: r.title,
    level: ts((LEVEL[r.level] ?? LEVEL.informational).key),
    events: r.eventIds.length ? r.eventIds.join(', ') : t('sigmaAnyEvent'),
  });

/**
 * Regras Sigma (plans/caca-e-formatos, item 1; analistas e admins): as da equipe, escritas e
 * testadas aqui, e o catalogo das vendorizadas (SigmaHQ), com ligar e desligar. A API compila com o
 * mesmo avaliador das deteccoes; cada mudanca refaz as deteccoes da regra nas execucoes guardadas.
 */
export function SigmaRulesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['sigma-rules'],
    queryFn: () =>
      api.get<{ rules: TeamSigmaRule[]; active: { vendored: number; team: number } }>(
        '/sigma/rules',
      ),
    // Enquanto alguma e reavaliada, a lista se atualiza sozinha.
    refetchInterval: (q) => (q.state.data?.rules.some((r) => r.evaluating) ? 3000 : false),
  });
  const rules = query.data?.rules ?? [];

  const [editing, setEditing] = useState<TeamSigmaRule | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [runId, setRunId] = useState('');
  const [test, setTest] = useState<SigmaTestResult | null>(null);

  const original = editing ? { source: editing.source, enabled: editing.enabled } : EMPTY;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const { allowNavigation } = useUnsavedChanges(dirty);
  const check = useRequiredFields([
    {
      id: 'sigma-source',
      label: t('sigmaYaml'),
      ok: form.source.trim().length > 0,
      api: 'source',
      value: form.source,
    },
  ]);

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setOutput(null);
    setTest(null);
    check.reset();
  };
  const startEdit = (rule: TeamSigmaRule) => {
    setEditing(rule);
    setForm({ source: rule.source, enabled: rule.enabled });
    setOutput(null);
    setTest(null);
    check.reset();
    setNotice(null);
  };

  // Vindo da deteccao do sandbox (?editar=<id>): abre a regra no editor.
  const editParam = params.get('editar');
  useEffect(() => {
    if (!editParam || !query.data) return;
    const rule = query.data.rules.find((r) => r.id === editParam);
    if (rule) startEdit(rule);
    setParams(
      (p) => {
        p.delete('editar');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, query.data]);

  const runs = useQuery({
    queryKey: ['sigma-runs'],
    queryFn: () =>
      api.get<{
        runs: { id: string; startedAt: string; entryTitle: string; events: number }[];
      }>('/sigma/runs'),
  });

  /** Erro do compilador no quadro abaixo do editor. */
  const compileErrors = (err: unknown): boolean => {
    const source = apiFieldErrors(err)?.source;
    if (!source?.length) return false;
    setOutput({ ok: false, lines: source });
    check.fromApi(err);
    return true;
  };

  const validate = async () => {
    setNotice(null);
    if (!check.check()) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; errors: string[]; rule?: SigmaRuleSummary }>(
        '/sigma/validate',
        { source: form.source },
      );
      setOutput(
        res.ok && res.rule ? { ok: true, rule: res.rule } : { ok: false, lines: res.errors },
      );
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setNotice(null);
    setTest(null);
    if (!check.check() || !runId) return;
    setBusy(true);
    try {
      const res = await api.post<SigmaTestResult>('/sigma/test', {
        source: form.source,
        sessionId: runId,
      });
      setTest(res);
      setOutput({ ok: true, rule: res.rule });
    } catch (err) {
      if (!compileErrors(err)) setNotice({ ok: false, text: (err as Error).message });
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
      const body = { source: form.source, enabled: form.enabled };
      const res = editing
        ? await api.patch<{ rule: TeamSigmaRule }>(`/sigma/rules/${editing.id}`, body)
        : await api.post<{ rule: TeamSigmaRule }>('/sigma/rules', body);
      await queryClient.invalidateQueries({ queryKey: ['sigma-rules'] });
      setNotice({ ok: true, text: t('sigmaSaved', { name: res.rule.name }) });
      allowNavigation();
      startNew();
    } catch (err) {
      if (!compileErrors(err) && !check.fromApi(err)) {
        setNotice({ ok: false, text: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule: TeamSigmaRule) => {
    setNotice(null);
    try {
      await api.patch(`/sigma/rules/${rule.id}`, { enabled: !rule.enabled });
      await queryClient.invalidateQueries({ queryKey: ['sigma-rules'] });
      setNotice({ ok: true, text: t(rule.enabled ? 'sigmaOff' : 'sigmaOn', { name: rule.name }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  const remove = async (rule: TeamSigmaRule) => {
    const ok = await confirm({
      title: t('deleteRule'),
      message: t('sigmaDeleteConfirm', { name: rule.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/sigma/rules/${rule.id}`);
      await queryClient.invalidateQueries({ queryKey: ['sigma-rules'] });
      if (editing?.id === rule.id) startNew();
      setNotice({ ok: true, text: t('ruleDeleted', { name: rule.name }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  useSaveShortcut(save, !busy);
  const runList = runs.data?.runs ?? [];

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
        title={t('sigmaTitle')}
        subtitle={
          query.data
            ? t('sigmaSubtitle', {
                team: query.data.active.team,
                vendored: query.data.active.vendored.toLocaleString(intlLocale()),
              })
            : undefined
        }
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && !output && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title={editing ? t('sigmaEdit', { name: editing.name }) : t('sigmaNew')}>
        <HpsmForm columns={2}>
          <HpsmField label={t('active')} htmlFor="sigma-enabled">
            <Checkbox
              id="sigma-enabled"
              labelText={t('sigmaApplyNext')}
              checked={form.enabled}
              onChange={(_, { checked }) => setForm((f) => ({ ...f, enabled: checked }))}
            />
          </HpsmField>
          <HpsmField label={t('sigmaTemplate')} htmlFor="sigma-template">
            <Button
              id="sigma-template"
              size="sm"
              kind="tertiary"
              disabled={form.source.trim().length > 0}
              onClick={() => setForm((f) => ({ ...f, source: TEMPLATE() }))}
            >
              {t('sigmaTemplate')}
            </Button>
          </HpsmField>
          <HpsmField
            label={t('sigmaYaml')}
            htmlFor="sigma-source"
            required
            wide
            top
            invalid={check.isInvalid('sigma-source')}
            help={t('sigmaHelp')}
          >
            <TextArea
              id="sigma-source"
              className="dl-code-input"
              labelText={t('sigmaYaml')}
              hideLabel
              rows={16}
              spellCheck={false}
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label={t('sigmaTestRun')} htmlFor="sigma-run" wide>
            {runList.length === 0 ? (
              <span className="dl-hint-muted">{t('sigmaTestNoRuns')}</span>
            ) : (
              <div className="dl-sigma-test">
                <Select
                  id="sigma-run"
                  labelText={t('sigmaTestRun')}
                  hideLabel
                  size="sm"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  <SelectItem value="" text={t('sigmaTestPick')} />
                  {runList.map((r) => (
                    <SelectItem
                      key={r.id}
                      value={r.id}
                      text={t('sigmaTestRunOption', {
                        title: r.entryTitle,
                        when: fmtDate(r.startedAt),
                        n: r.events.toLocaleString(intlLocale()),
                      })}
                    />
                  ))}
                </Select>
                <Button
                  size="sm"
                  kind="tertiary"
                  disabled={busy || !runId}
                  onClick={() => void runTest()}
                >
                  {busy ? t('sigmaTesting') : t('sigmaTest')}
                </Button>
              </div>
            )}
          </HpsmField>
        </HpsmForm>
        {output && (
          <div className="dl-compiler-output" data-ok={output.ok} role="status">
            <strong>{output.ok ? t('compilerOk') : t('compilerError')}</strong>
            <pre>{output.ok ? summaryLine(output.rule) : output.lines.join('\n\n')}</pre>
          </div>
        )}
        {test && <TestResult result={test} />}
      </HpsmSection>

      <HpsmSection title={t('sigmaTeamSection')}>
        {query.isLoading && <HpsmLoading text={t('loadingRules2')} />}
        {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
        {query.data && rules.length === 0 && <p className="dl-hint-muted">{t('sigmaNoTeam')}</p>}
        {rules.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label={t('sigmaTeamSection')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('name')}</TableHeader>
                  <TableHeader scope="col">{t('sigmaLevel')}</TableHeader>
                  <TableHeader scope="col">{t('situation')}</TableHeader>
                  <TableHeader scope="col">{t('sigmaFired')}</TableHeader>
                  <TableHeader scope="col">{t('changedBy')}</TableHeader>
                  <TableHeader scope="col">{t('updatedAt')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={editing?.id === rule.id ? 'is-selected' : undefined}
                  >
                    <TableCell>{rule.name}</TableCell>
                    <TableCell>{rule.rule ? <Level level={rule.rule.level} /> : '—'}</TableCell>
                    <TableCell>
                      <StatusText tone={rule.enabled ? 'green' : 'gray'}>
                        {rule.enabled ? t('active') : t('disabledF')}
                      </StatusText>
                      {rule.evaluating && (
                        <span className="dl-hint-muted"> · {t('sigmaEvaluating')}</span>
                      )}
                    </TableCell>
                    <TableCell>{t('sigmaFiredRuns', { n: rule.firedRuns })}</TableCell>
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
        )}
      </HpsmSection>

      <SigmaCatalog onNotice={setNotice} />
    </>
  );
}

function TestResult({ result }: { result: SigmaTestResult }) {
  return (
    <div className="dl-sigma-test__result" role="status">
      <p>
        {t('sigmaTestResult', {
          n: result.matched.toLocaleString(intlLocale()),
          scanned: result.scanned.toLocaleString(intlLocale()),
        })}
        {result.truncated && ` ${t('sigmaTestTruncated')}`}
      </p>
      {result.events.length > 0 && (
        <>
          <p className="dl-hint-muted">{t('sigmaTestFirst', { n: result.events.length })}</p>
          <table className="dl-risk__reasons" aria-label={t('sigmaTest')}>
            <thead>
              <tr>
                <th scope="col">{t('sigmaWhen')}</th>
                <th scope="col">{t('sigmaEvent')}</th>
                <th scope="col">{t('sigmaProcess')}</th>
                <th scope="col">CommandLine / TargetObject / TargetFilename</th>
              </tr>
            </thead>
            <tbody>
              {result.events.map((e, i) => (
                <tr key={i}>
                  <td>
                    <time dateTime={e.time}>
                      {new Date(e.time).toLocaleTimeString(intlLocale())}
                    </time>
                  </td>
                  <td>{e.eventId}</td>
                  <td className="dl-mono" title={e.image ?? undefined}>
                    {base(e.image)}
                    {e.pid !== null && ` (${e.pid})`}
                    <span className="dl-hint-muted">
                      {' '}
                      · {e.sample ? t('sigmaOfSample') : t('sigmaNotSample')}
                    </span>
                  </td>
                  <td className="dl-mono dl-break">
                    {e.event.CommandLine ??
                      e.event.TargetObject ??
                      e.event.TargetFilename ??
                      e.event.QueryName ??
                      e.event.DestinationIp ??
                      '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

type CatalogPage = {
  source: { name: string | null; release: string | null; license: string | null };
  /** Ausente numa API anterior as colecoes. */
  collections?: { id: string; name: string; rules: number; defaultEnabled: boolean }[];
  total: number;
  disabledTotal: number;
  page: number;
  pageSize: number;
  rules: CatalogSigmaRule[];
};

const COLLECTION_LABEL = {
  core: 'sigmaCollectionCore',
  emerging: 'sigmaCollectionEmerging',
  hunting: 'sigmaCollectionHunting',
} as const;
/** O nome da colecao na lingua da tela (a desconhecida fica com o nome do manifesto). */
const collectionName = (id: string | null, fallback = '—') =>
  id && id in COLLECTION_LABEL
    ? t(COLLECTION_LABEL[id as keyof typeof COLLECTION_LABEL])
    : fallback;

/** O catalogo das vendorizadas: busca, nivel, colecao, ligadas ou desligadas e o botao de cada uma. */
function SigmaCatalog({ onNotice }: { onNotice: (n: { ok: boolean; text: string }) => void }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [state, setState] = useState<'all' | 'on' | 'off'>('all');
  const [collection, setCollection] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ state, page: String(page) });
  if (search) params.set('q', search);
  if (level) params.set('level', level);
  if (collection) params.set('collection', collection);
  const query = useQuery({
    queryKey: ['sigma-catalog', search, level, collection, state, page],
    queryFn: () => api.get<CatalogPage>(`/sigma/catalog?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: (qq) => (qq.state.data?.rules.some((r) => r.evaluating) ? 3000 : false),
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const toggle = async (rule: CatalogSigmaRule) => {
    try {
      await api.patch(`/sigma/catalog/${encodeURIComponent(rule.ruleId)}`, {
        enabled: !rule.enabled,
      });
      await queryClient.invalidateQueries({ queryKey: ['sigma-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['sigma-rules'] });
      onNotice({ ok: true, text: t(rule.enabled ? 'sigmaOff' : 'sigmaOn', { name: rule.title }) });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <HpsmSection title={t('sigmaCatalog', { release: data?.source.release ?? '' })}>
      {data?.source.license && (
        <p className="dl-hint-muted">{t('sigmaCatalogHelp', { license: data.source.license })}</p>
      )}
      {data?.collections?.some((c) => !c.defaultEnabled) && (
        <p className="dl-hint-muted">{t('sigmaHuntingHelp')}</p>
      )}
      <form
        className="dl-sigma-catalog__filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <TextInput
          id="sigma-catalog-q"
          labelText={t('sigmaSearch')}
          hideLabel
          size="sm"
          placeholder={t('sigmaSearch')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          id="sigma-catalog-level"
          labelText={t('sigmaLevel')}
          hideLabel
          size="sm"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(1);
          }}
        >
          <SelectItem value="" text={t('sigmaAllLevels')} />
          {Object.entries(LEVEL).map(([value, l]) => (
            <SelectItem key={value} value={value} text={ts(l.key)} />
          ))}
        </Select>
        {(data?.collections?.length ?? 0) > 1 && (
          <Select
            id="sigma-catalog-collection"
            labelText={t('sigmaCollection')}
            hideLabel
            size="sm"
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setPage(1);
            }}
          >
            <SelectItem value="" text={t('sigmaAllCollections')} />
            {data?.collections?.map((c) => {
              const name = `${collectionName(c.id, c.name)} · ${c.rules}`;
              return (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  text={c.defaultEnabled ? name : t('sigmaCollectionOptIn', { name })}
                />
              );
            })}
          </Select>
        )}
        <Select
          id="sigma-catalog-state"
          labelText={t('situation')}
          hideLabel
          size="sm"
          value={state}
          onChange={(e) => {
            setState(e.target.value as typeof state);
            setPage(1);
          }}
        >
          <SelectItem value="all" text={t('sigmaStateAll')} />
          <SelectItem value="on" text={t('sigmaStateOn')} />
          <SelectItem value="off" text={t('sigmaStateOff')} />
        </Select>
        <Button size="sm" kind="tertiary" type="submit">
          {t('search')}
        </Button>
      </form>
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {!data ? (
        <HpsmLoading text={t('loadingRules2')} />
      ) : (
        <>
          <p className="dl-hint-muted">
            {t('sigmaCatalogCount', { n: data.total, off: data.disabledTotal })}
          </p>
          <TableContainer>
            <Table size="xs" aria-label={t('sigmaCatalog', { release: data.source.release ?? '' })}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('name')}</TableHeader>
                  <TableHeader scope="col">{t('sigmaLevel')}</TableHeader>
                  <TableHeader scope="col">{t('sigmaCollection')}</TableHeader>
                  <TableHeader scope="col">{t('sigmaEvents')}</TableHeader>
                  <TableHeader scope="col">ATT&amp;CK</TableHeader>
                  <TableHeader scope="col">{t('sigmaFired')}</TableHeader>
                  <TableHeader scope="col">{t('situation')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rules.map((r) => (
                  <TableRow key={r.ruleId}>
                    <TableCell>
                      <span title={r.description ?? undefined}>{r.title}</span>
                      {r.url && (
                        <>
                          {' · '}
                          <a href={r.url} target="_blank" rel="noreferrer noopener">
                            {t('sigmaView')}
                          </a>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <Level level={r.level} />
                    </TableCell>
                    <TableCell>{collectionName(r.collection)}</TableCell>
                    <TableCell>{r.eventIds.length ? r.eventIds.join(', ') : '—'}</TableCell>
                    <TableCell>
                      {r.techniques.length ? <AttackTechniqueLinks ids={r.techniques} /> : '—'}
                    </TableCell>
                    <TableCell>{t('sigmaFiredRuns', { n: r.firedRuns })}</TableCell>
                    <TableCell>
                      <StatusText tone={r.enabled ? 'green' : 'gray'}>
                        {r.enabled ? t('sigmaRuleOn') : t('sigmaRuleOff')}
                      </StatusText>
                      {r.evaluating && (
                        <span className="dl-hint-muted"> · {t('sigmaEvaluating')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" kind="tertiary" onClick={() => void toggle(r)}>
                        {r.enabled ? t('sigmaTurnOff') : t('sigmaTurnOn')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {pages > 1 && (
            <div className="dl-pager">
              <Button
                size="sm"
                kind="tertiary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('previous')}
              </Button>
              <span>{t('sigmaPage', { page, pages })}</span>
              <Button
                size="sm"
                kind="tertiary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          )}
        </>
      )}
    </HpsmSection>
  );
}
