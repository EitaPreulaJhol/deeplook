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
import { intlLocale } from '../i18n';
import { t } from '../i18n/admin';
import { useConfirm } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { VerdictTag } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
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
      label: t('nameRange'),
      ok: form.name.trim().length >= 2,
      api: 'name',
      value: form.name,
    },
    {
      id: 'tpl-summary',
      label: t('summaryMin'),
      ok: form.summary.trim().length >= 3,
      api: 'summary',
      value: form.summary,
    },
    { id: 'tpl-findings', label: t('findings'), ok: true, api: 'findings', value: form.findings },
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
      setNotice({ ok: true, text: t('templateSaved', { name: res.template.name }) });
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
      title: t('deleteTemplate'),
      message: t('deleteTemplateConfirm', { name: template.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/report-templates/${template.id}`);
      await queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      if (editing?.id === template.id) startNew();
      setNotice({ ok: true, text: t('templateDeleted', { name: template.name }) });
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

      <HpsmSection title={editing ? t('editTemplate', { name: editing.name }) : t('newTemplate')}>
        <HpsmToolbar label={t('templateActions')}>
          <HpsmToolbarButton
            label={saving ? t('saving') : t('saveTemplate')}
            title={t('saveHint')}
            icon={IconAdd}
            disabled={saving}
            onClick={save}
          />
          {editing && <HpsmToolbarButton label={t('cancelEdit')} onClick={startNew} />}
        </HpsmToolbar>
        <HpsmForm columns={2}>
          <HpsmField
            label={t('name')}
            htmlFor="tpl-name"
            required
            invalid={check.isInvalid('tpl-name')}
          >
            <TextInput
              id="tpl-name"
              labelText={t('name')}
              hideLabel
              placeholder={t('templatePlaceholder')}
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
            />
          </HpsmField>
          <HpsmField label={t('suggestedVerdict')} htmlFor="tpl-verdict">
            <Select
              id="tpl-verdict"
              labelText={t('suggestedVerdict')}
              hideLabel
              value={form.verdict}
              onChange={(e) => set('verdict')(e.target.value)}
            >
              <SelectItem value="UNKNOWN" text={t('vUnknown')} />
              <SelectItem value="CLEAN" text={t('vClean')} />
              <SelectItem value="SUSPICIOUS" text={t('vSuspicious')} />
              <SelectItem value="MALICIOUS" text={t('vMalicious')} />
            </Select>
          </HpsmField>
          <HpsmField
            label={t('summary')}
            htmlFor="tpl-summary"
            required
            wide
            top
            invalid={check.isInvalid('tpl-summary')}
          >
            <TextArea
              id="tpl-summary"
              labelText={t('summary')}
              hideLabel
              rows={3}
              value={form.summary}
              onChange={(e) => set('summary')(e.target.value)}
            />
          </HpsmField>
          <HpsmField
            label={t('findings')}
            htmlFor="tpl-findings"
            wide
            top
            invalid={check.isInvalid('tpl-findings')}
          >
            <TextArea
              id="tpl-findings"
              labelText={t('findings')}
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
            help={t('iocsHelp')}
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

      {query.isLoading && <HpsmLoading text={t('loadingTemplates')} />}
      {query.data && templates.length === 0 && (
        <HpsmMessage kind="info">{t('noTemplates')}</HpsmMessage>
      )}
      {templates.length > 0 && (
        <TableContainer className="dl-mt-lg">
          <Table size="xs" aria-label={t('templatesAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('name')}</TableHeader>
                <TableHeader scope="col">{t('suggestedVerdict')}</TableHeader>
                <TableHeader scope="col">{t('updatedAt')}</TableHeader>
                <TableHeader scope="col">{t('actions')}</TableHeader>
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
                      {t('edit')}
                    </Button>{' '}
                    <Button
                      size="sm"
                      kind="danger--tertiary"
                      aria-label={t('deleteTemplateNamed', { name: template.name })}
                      onClick={() => void remove(template)}
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
    </>
  );
}
