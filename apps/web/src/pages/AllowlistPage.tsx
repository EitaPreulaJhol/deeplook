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
  TextInput,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { IocKind } from '../api/types';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd, IconDownload } from '../components/icons';
import { IocImportDialog } from '../components/IocImportDialog';
import { IOC_KIND_LABELS } from '../components/iocs';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/detection';

interface Allowed {
  id: string;
  kind: IocKind;
  value: string;
  reason: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
}

const KINDS: { id: IocKind; placeholder: string; help: string }[] = localized(() => [
  { id: 'DOMAIN', placeholder: t('phDomain'), help: t('hDomain') },
  { id: 'IPV4', placeholder: t('phIpv4'), help: t('hIpv4') },
  {
    id: 'IPV6',
    placeholder: t('phIpv6'),
    help: t('hIpv6'),
  },
  {
    id: 'URL',
    placeholder: t('phUrl'),
    help: t('hUrl'),
  },
  { id: 'EMAIL', placeholder: t('phEmail'), help: t('hEmail') },
  { id: 'SHA256', placeholder: t('ph64'), help: t('hHash') },
  { id: 'SHA1', placeholder: t('ph40'), help: t('hHash') },
  { id: 'MD5', placeholder: t('ph32'), help: t('hHash') },
]);

const EMPTY = { kind: 'DOMAIN' as IocKind, value: '', reason: '' };

/**
 * Indicadores permitidos (item 69; analistas): dominios, IPs/faixas, hashes e
 * e-mails legitimos. Nao ligam amostras nas Relacionadas, nao disparam alertas
 * de IOC e somem dos IOCs sugeridos do relatorio.
 */
export function AllowlistPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['allowlist'],
    queryFn: () => api.get<{ items: Allowed[] }>('/allowlist'),
  });
  const items = query.data?.items ?? [];
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const { allowNavigation } = useUnsavedChanges(Boolean(form.value || form.reason));
  const kind = KINDS.find((k) => k.id === form.kind)!;

  const check = useRequiredFields([
    {
      id: 'allow-value',
      label: t('indicator'),
      ok: form.value.trim().length > 0,
      api: 'value',
      value: form.value,
    },
    {
      id: 'allow-reason',
      label: t('reasonMin'),
      ok: form.reason.trim().length >= 3,
      api: 'reason',
      value: form.reason,
    },
  ]);

  const add = async () => {
    setNotice(null);
    if (!check.check()) return;
    setBusy(true);
    try {
      const res = await api.post<{ item: Allowed }>('/allowlist', form);
      await queryClient.invalidateQueries({ queryKey: ['allowlist'] });
      setNotice({
        ok: true,
        text: `${IOC_KIND_LABELS[res.item.kind]} ${res.item.value} permitido.`,
      });
      allowNavigation();
      setForm((f) => ({ ...EMPTY, kind: f.kind }));
      check.reset();
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  useSaveShortcut(add, !busy);

  const remove = async (item: Allowed) => {
    const ok = await confirm({
      title: t('removeFromAllowlist'),
      message: t('removeAllowConfirm', { value: item.value }),
      confirmLabel: t('remove'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/allowlist/${item.id}`);
      await queryClient.invalidateQueries({ queryKey: ['allowlist'] });
      setNotice({ ok: true, text: t('removedFromAllowlist', { value: item.value }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      <HpsmToolbar label={t('allowActions')}>
        <HpsmToolbarButton
          label={busy ? t('adding') : t('add')}
          title={t('addHint')}
          icon={IconAdd}
          disabled={busy}
          onClick={() => void add()}
        />
        <HpsmToolbarButton
          label={t('importEllipsis')}
          title={t('importHelp')}
          icon={IconDownload}
          onClick={() => setImporting(true)}
        />
      </HpsmToolbar>
      {importing && (
        <IocImportDialog
          target="allow"
          onClose={() => setImporting(false)}
          onDone={(text) => {
            setImporting(false);
            setNotice({ ok: true, text });
            void queryClient.invalidateQueries({ queryKey: ['allowlist'] });
          }}
        />
      )}
      <PageHeader title={t('allowTitle')} subtitle={t('allowSubtitle')} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      <HpsmSection title={t('addIndicator')}>
        <HpsmForm columns={2}>
          <HpsmField label={t('type')} htmlFor="allow-kind">
            <Select
              id="allow-kind"
              labelText={t('type')}
              hideLabel
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as IocKind }))}
            >
              {KINDS.map((k) => (
                <SelectItem key={k.id} value={k.id} text={IOC_KIND_LABELS[k.id]} />
              ))}
            </Select>
          </HpsmField>
          <HpsmField
            label={t('indicator')}
            htmlFor="allow-value"
            required
            help={kind.help}
            invalid={check.isInvalid('allow-value')}
          >
            <TextInput
              id="allow-value"
              labelText={t('indicator')}
              hideLabel
              placeholder={kind.placeholder}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          </HpsmField>
          <HpsmField
            label={t('reason')}
            htmlFor="allow-reason"
            required
            wide
            invalid={check.isInvalid('allow-reason')}
          >
            <TextInput
              id="allow-reason"
              labelText={t('reason')}
              hideLabel
              placeholder={t('reasonPlaceholder')}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      {query.isLoading && <HpsmLoading text={t('loadingList')} />}
      {query.data && items.length === 0 && <HpsmMessage kind="info">{t('noAllowed')}</HpsmMessage>}
      {items.length > 0 && (
        <TableContainer className="dl-mt-lg">
          <Table size="xs" aria-label={t('allowTitle')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('type')}</TableHeader>
                <TableHeader scope="col">{t('indicator')}</TableHeader>
                <TableHeader scope="col">{t('reason')}</TableHeader>
                <TableHeader scope="col">{t('addedCol')}</TableHeader>
                <TableHeader scope="col">{t('actions')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{IOC_KIND_LABELS[item.kind]}</TableCell>
                  <TableCell>
                    <span className="dl-mono">{item.value}</span>
                  </TableCell>
                  <TableCell>{item.reason}</TableCell>
                  <TableCell>
                    {new Date(item.createdAt).toLocaleDateString(intlLocale())}
                    {item.createdBy ? ` por ${item.createdBy.displayName}` : ''}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      kind="danger--tertiary"
                      aria-label={t('removeValue', { value: item.value })}
                      onClick={() => void remove(item)}
                    >
                      {t('remove')}
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
