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
import { useSaveShortcut } from '../components/shortcuts';
import { StatusText } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

const SAMPLE = `rule Exemplo_Dropper : dropper
{
  meta:
    description = "Executável com a string do dropper"
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
    queryFn: () => api.get<{ rules: YaraRule[] }>('/yara/rules'),
  });
  const rules = query.data?.rules ?? [];
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
      label: 'Nome (2 a 80 caracteres)',
      ok: form.name.trim().length >= 2 && form.name.trim().length <= 80,
      api: 'name',
      value: form.name,
    },
    {
      id: 'yara-source',
      label: 'Regra',
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
          ? { ok: true, lines: res.warnings.length ? res.warnings : ['A regra compila sem erros.'] }
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
        text: `Regra "${res.rule.name}" salva${res.rule.enabled ? '; vale para os próximos envios' : ' (desativada)'}.`,
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
        text: `Regra "${rule.name}" ${rule.enabled ? 'desativada' : 'ativada'}.`,
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  const remove = async (rule: YaraRule) => {
    const ok = await confirm({
      title: 'Excluir regra',
      message: `Excluir a regra "${rule.name}"? Os acertos já registrados nas amostras continuam lá.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/yara/rules/${rule.id}`);
      await queryClient.invalidateQueries({ queryKey: ['yara-rules'] });
      if (editing?.id === rule.id) startNew();
      setNotice({ ok: true, text: `Regra "${rule.name}" excluída.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  useSaveShortcut(save, !busy);

  return (
    <>
      <HpsmToolbar label="Ações da regra">
        <HpsmToolbarButton
          label={busy ? 'Salvando...' : 'Salvar regra'}
          title="Salvar (Ctrl+S)"
          icon={IconAdd}
          disabled={busy}
          onClick={save}
        />
        <HpsmToolbarButton label="Validar" disabled={busy} onClick={() => void validate()} />
        {editing && <HpsmToolbarButton label="Cancelar edição" onClick={startNew} />}
      </HpsmToolbar>
      <PageHeader
        title="Regras YARA"
        subtitle={`Aplicadas a cada arquivo enviado (${active} ativa${active === 1 ? '' : 's'}). O resultado aparece na ficha da amostra.`}
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && !output && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title={editing ? `Editar regra: ${editing.name}` : 'Nova regra'}>
        <HpsmForm columns={2}>
          <HpsmField
            label="Nome"
            htmlFor="yara-name"
            required
            invalid={check.isInvalid('yara-name')}
          >
            <TextInput
              id="yara-name"
              labelText="Nome"
              hideLabel
              placeholder="Ex.: Família XYZ"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label="Ativa" htmlFor="yara-enabled">
            <Checkbox
              id="yara-enabled"
              labelText="Aplicar aos próximos envios"
              checked={form.enabled}
              onChange={(_, { checked }) => setForm((f) => ({ ...f, enabled: checked }))}
            />
          </HpsmField>
          <HpsmField label="Descrição" htmlFor="yara-description" wide>
            <TextInput
              id="yara-description"
              labelText="Descrição"
              hideLabel
              placeholder="Opcional: o que a regra detecta"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </HpsmField>
          <HpsmField
            label="Regra"
            htmlFor="yara-source"
            required
            wide
            top
            invalid={check.isInvalid('yara-source')}
            help="Sintaxe YARA; o arquivo pode ter várias regras. Validada antes de salvar."
          >
            <TextArea
              id="yara-source"
              className="dl-code-input"
              labelText="Regra"
              hideLabel
              rows={14}
              spellCheck={false}
              placeholder={SAMPLE}
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
        {output && (
          <div className="dl-compiler-output" data-ok={output.ok} role="status">
            <strong>{output.ok ? 'Compilador: ok' : 'Compilador: erro'}</strong>
            <pre>{output.lines.join('\n\n')}</pre>
          </div>
        )}
      </HpsmSection>

      {query.isLoading && <HpsmLoading text="Carregando regras..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && rules.length === 0 && (
        <HpsmMessage kind="info">Nenhuma regra YARA cadastrada.</HpsmMessage>
      )}
      {rules.length > 0 && (
        <TableContainer className="dl-mt-lg">
          <Table size="xs" aria-label="Regras YARA">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Nome</TableHeader>
                <TableHeader scope="col">Situação</TableHeader>
                <TableHeader scope="col">Descrição</TableHeader>
                <TableHeader scope="col">Alterada por</TableHeader>
                <TableHeader scope="col">Atualizada em</TableHeader>
                <TableHeader scope="col">Ações</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow
                  key={rule.id}
                  className={editing?.id === rule.id ? 'is-selected' : undefined}
                >
                  <TableCell>{rule.name}</TableCell>
                  <TableCell>
                    <StatusText tone={rule.enabled ? 'green' : 'gray'}>
                      {rule.enabled ? 'Ativa' : 'Desativada'}
                    </StatusText>
                  </TableCell>
                  <TableCell>{rule.description ?? '—'}</TableCell>
                  <TableCell>{rule.updatedBy?.displayName ?? '—'}</TableCell>
                  <TableCell>{fmtDate(rule.updatedAt)}</TableCell>
                  <TableCell>
                    <Button size="sm" kind="tertiary" onClick={() => startEdit(rule)}>
                      Editar
                    </Button>{' '}
                    <Button size="sm" kind="tertiary" onClick={() => void toggle(rule)}>
                      {rule.enabled ? 'Desativar' : 'Ativar'}
                    </Button>{' '}
                    <Button
                      size="sm"
                      kind="danger--tertiary"
                      aria-label={`Excluir a regra ${rule.name}`}
                      onClick={() => void remove(rule)}
                    >
                      Excluir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
