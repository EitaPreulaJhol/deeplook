import { Select, SelectItem, TextArea } from '@carbon/react';
import { useState } from 'react';

import { api } from '../api/client';
import type { Report, Verdict } from '../api/types';
import { t } from '../i18n/entry';
import { AttackPicker } from './attack';
import { HpsmField, HpsmForm, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { KbPicker, type KbRef } from './KbPicker';
import { HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { useUnsavedChanges } from './useUnsavedChanges';

/**
 * Edicao de um relatorio (item 75), no lugar da leitura: Resumo, Achados, IOCs,
 * ATT&CK, artigos da base e veredito. A versao anterior fica guardada na API
 * (Versoes); a situacao (rascunho/publicado) nao muda aqui.
 */
export function ReportEditForm({
  report,
  onSaved,
  onCancel,
}: {
  report: Report;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState(report.summary);
  const [findings, setFindings] = useState(report.findings ?? '');
  const [iocs, setIocs] = useState(report.iocs ?? '');
  const [attack, setAttack] = useState<string[]>(report.attackTechniques ?? []);
  const [kb, setKb] = useState<KbRef[]>(report.kbArticles ?? []);
  const [verdict, setVerdict] = useState<Verdict>(report.verdict);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    summary !== report.summary ||
    findings !== (report.findings ?? '') ||
    iocs !== (report.iocs ?? '') ||
    attack.join() !== (report.attackTechniques ?? []).join() ||
    kb.map((a) => a.id).join() !== (report.kbArticles ?? []).map((a) => a.id).join() ||
    verdict !== report.verdict;
  const { allowNavigation } = useUnsavedChanges(dirty);

  const check = useRequiredFields([
    {
      id: 'report-edit-summary',
      label: t('summary'),
      ok: summary.trim().length >= 3,
      api: 'summary',
      value: summary,
    },
    {
      id: 'report-edit-findings',
      label: t('findings'),
      ok: true,
      api: 'findings',
      value: findings,
    },
    { id: 'report-edit-iocs', label: 'IOCs', ok: true, api: 'iocs', value: iocs },
    {
      id: 'report-edit-attack',
      label: t('attackTechniques'),
      ok: true,
      api: 'attackTechniques',
      value: attack.join(','),
    },
  ]);

  const save = async () => {
    setError(null);
    if (!check.check()) return;
    setSaving(true);
    try {
      await api.patch(`/reports/${report.id}`, {
        summary,
        findings,
        iocs,
        verdict,
        attackTechniques: attack,
        kbArticleIds: kb.map((a) => a.id),
      });
      allowNavigation();
      onSaved();
    } catch (err) {
      if (!check.fromApi(err)) setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(save, !saving && dirty);

  return (
    <>
      <HpsmToolbar label={t('reportEditing')}>
        <HpsmToolbarButton
          label={saving ? t('saving') : t('saveChanges')}
          title={t('saveHint')}
          icon={IconAdd}
          disabled={saving || !dirty}
          onClick={() => void save()}
        />
        <HpsmToolbarButton
          label={t('cancel')}
          disabled={saving}
          onClick={() => {
            allowNavigation();
            onCancel();
          }}
        />
        <span className="hpsm-toolbar__info">{t('currentKept')}</span>
      </HpsmToolbar>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      <HpsmForm>
        <HpsmField
          label={t('summary')}
          htmlFor="report-edit-summary"
          required
          top
          invalid={check.isInvalid('report-edit-summary')}
        >
          <TextArea
            id="report-edit-summary"
            labelText={t('summary')}
            hideLabel
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label={t('findings')}
          htmlFor="report-edit-findings"
          top
          invalid={check.isInvalid('report-edit-findings')}
        >
          <TextArea
            id="report-edit-findings"
            labelText={t('findings')}
            hideLabel
            rows={5}
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label="IOCs"
          htmlFor="report-edit-iocs"
          top
          invalid={check.isInvalid('report-edit-iocs')}
        >
          <TextArea
            id="report-edit-iocs"
            labelText="IOCs"
            hideLabel
            rows={3}
            value={iocs}
            onChange={(e) => setIocs(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label={t('attackTechniques')}
          htmlFor="report-edit-attack"
          top
          invalid={check.isInvalid('report-edit-attack')}
        >
          <AttackPicker id="report-edit-attack" value={attack} onChange={setAttack} />
        </HpsmField>
        <HpsmField label={t('kbArticles')} htmlFor="report-edit-kb" top>
          <KbPicker id="report-edit-kb" value={kb} onChange={setKb} />
        </HpsmField>
        <HpsmField
          label={t('colVerdict')}
          htmlFor="report-edit-verdict"
          help={report.status === 'PUBLISHED' ? t('publishedVerdictHelp') : undefined}
        >
          <Select
            id="report-edit-verdict"
            labelText={t('colVerdict')}
            hideLabel
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as Verdict)}
          >
            <SelectItem value="UNKNOWN" text={t('vUnknown')} />
            <SelectItem value="CLEAN" text={t('vClean')} />
            <SelectItem value="SUSPICIOUS" text={t('vSuspicious')} />
            <SelectItem value="MALICIOUS" text={t('vMalicious')} />
          </Select>
        </HpsmField>
      </HpsmForm>
    </>
  );
}
