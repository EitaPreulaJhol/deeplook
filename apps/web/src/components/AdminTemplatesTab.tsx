import {
  Button,
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { ReportTemplate, Verdict } from '../api/types';
import { useConfirm } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { VerdictTag } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

const EMPTY = { name: '', summary: '', findings: '', iocs: '', verdict: 'UNKNOWN' as Verdict };

/**
 * Aba "Modelos de relatorio" da Administracao: lista e formulario (novo ou
 * edicao). Os analistas escolhem o modelo no "Novo relatorio" da amostra.
 */
export function AdminTemplatesTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['report-templates'],
    queryFn: () => api.get<{ templates: ReportTemplate[] }>('/report-templates'),
  });
  const templates = query.data?.templates ?? [];

  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const original = editing
    ? {
        name: editing.name,
        summary: editing.summary,
        findings: editing.findings ?? '',
        iocs: editing.iocs ?? '',
        verdict: editing.verdict,
      }
    : EMPTY;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const { allowNavigation } = useUnsavedChanges(dirty);

  const check = useRequiredFields([
    {
      id: 'tpl-name',
      label: 'Nome (2 a 80 caracteres)',
      ok: form.name.trim().length >= 2,
      api: 'name',
      value: form.name,
    },
    {
      id: 'tpl-summary',
      label: 'Resumo (mínimo de 3 caracteres)',
      ok: form.summary.trim().length >= 3,
      api: 'summary',
      value: form.summary,
    },
    { id: 'tpl-findings', label: 'Achados', ok: true, api: 'findings', value: form.findings },
    { id: 'tpl-iocs', label: 'IOCs', ok: true, api: 'iocs', value: form.iocs },
  ]);

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY);
    check.reset();
  };
  const startEdit = (template: ReportTemplate) => {
    setEditing(template);
    setForm({
      name: template.name,
      summary: template.summary,
      findings: template.findings ?? '',
      iocs: template.iocs ?? '',
      verdict: template.verdict,
    });
    check.reset();
    setNotice(null);
  };

  const save = async () => {
    setNotice(null);
    if (!check.check()) return;
    setSaving(true);
    try {
      const res = editing
        ? await api.patch<{ template: ReportTemplate }>(`/report-templates/${editing.id}`, form)
        : await api.post<{ template: ReportTemplate }>('/report-templates', form);
      await queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      setNotice({ ok: true, text: `Modelo "${res.template.name}" salvo.` });
      allowNavigation();
      startNew();
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template: ReportTemplate) => {
    const ok = await confirm({
      title: 'Excluir modelo',
      message: `Excluir o modelo "${template.name}"? Relatórios já escritos não mudam.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/report-templates/${template.id}`);
      await queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      if (editing?.id === template.id) startNew();
      setNotice({ ok: true, text: `Modelo "${template.name}" excluído.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title={editing ? `Editar modelo: ${editing.name}` : 'Novo modelo'}>
        <HpsmToolbar label="Ações do modelo">
          <HpsmToolbarButton
            label={saving ? 'Salvando...' : 'Salvar modelo'}
            title="Salvar (Ctrl+S)"
            icon={IconAdd}
            disabled={saving}
            onClick={save}
          />
          {editing && <HpsmToolbarButton label="Cancelar edição" onClick={startNew} />}
        </HpsmToolbar>
        <HpsmForm columns={2}>
          <HpsmField label="Nome" htmlFor="tpl-name" required invalid={check.isInvalid('tpl-name')}>
            <TextInput
              id="tpl-name"
              labelText="Nome"
              hideLabel
              placeholder="Ex.: Phishing de credenciais"
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
            />
          </HpsmField>
          <HpsmField label="Veredito sugerido" htmlFor="tpl-verdict">
            <Select
              id="tpl-verdict"
              labelText="Veredito sugerido"
              hideLabel
              value={form.verdict}
              onChange={(e) => set('verdict')(e.target.value)}
            >
              <SelectItem value="UNKNOWN" text="Desconhecido" />
              <SelectItem value="CLEAN" text="Limpo" />
              <SelectItem value="SUSPICIOUS" text="Suspeito" />
              <SelectItem value="MALICIOUS" text="Malicioso" />
            </Select>
          </HpsmField>
          <HpsmField
            label="Resumo"
            htmlFor="tpl-summary"
            required
            wide
            top
            invalid={check.isInvalid('tpl-summary')}
          >
            <TextArea
              id="tpl-summary"
              labelText="Resumo"
              hideLabel
              rows={3}
              value={form.summary}
              onChange={(e) => set('summary')(e.target.value)}
            />
          </HpsmField>
          <HpsmField
            label="Achados"
            htmlFor="tpl-findings"
            wide
            top
            invalid={check.isInvalid('tpl-findings')}
          >
            <TextArea
              id="tpl-findings"
              labelText="Achados"
              hideLabel
              rows={4}
              value={form.findings}
              onChange={(e) => set('findings')(e.target.value)}
            />
          </HpsmField>
          <HpsmField
            label="IOCs"
            htmlFor="tpl-iocs"
            wide
            top
            invalid={check.isInvalid('tpl-iocs')}
            help="Opcional: indicadores comuns a este tipo de caso."
          >
            <TextArea
              id="tpl-iocs"
              labelText="IOCs"
              hideLabel
              rows={2}
              value={form.iocs}
              onChange={(e) => set('iocs')(e.target.value)}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      {query.isLoading && <HpsmLoading text="Carregando modelos..." />}
      {query.data && templates.length === 0 && (
        <HpsmMessage kind="info">Nenhum modelo de relatório cadastrado.</HpsmMessage>
      )}
      {templates.length > 0 && (
        <TableContainer className="dl-mt-lg">
          <Table size="xs" aria-label="Modelos de relatório">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Nome</TableHeader>
                <TableHeader scope="col">Veredito sugerido</TableHeader>
                <TableHeader scope="col">Atualizado em</TableHeader>
                <TableHeader scope="col">Ações</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((template) => (
                <TableRow
                  key={template.id}
                  className={editing?.id === template.id ? 'is-selected' : undefined}
                >
                  <TableCell>{template.name}</TableCell>
                  <TableCell>
                    <VerdictTag verdict={template.verdict} />
                  </TableCell>
                  <TableCell>{fmtDate(template.updatedAt)}</TableCell>
                  <TableCell>
                    <Button size="sm" kind="tertiary" onClick={() => startEdit(template)}>
                      Editar
                    </Button>{' '}
                    <Button
                      size="sm"
                      kind="danger--tertiary"
                      aria-label={`Excluir o modelo ${template.name}`}
                      onClick={() => void remove(template)}
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
