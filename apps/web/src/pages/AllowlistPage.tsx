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

interface Allowed {
  id: string;
  kind: IocKind;
  value: string;
  reason: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
}

const KINDS: { id: IocKind; placeholder: string; help: string }[] = [
  { id: 'DOMAIN', placeholder: 'empresa.com.br', help: 'Vale também para os subdomínios.' },
  { id: 'IPV4', placeholder: '10.0.0.0/8 ou 203.0.113.10', help: 'Um IP ou uma faixa (CIDR).' },
  {
    id: 'IPV6',
    placeholder: '2001:db8::/32 ou 2606:4700::1111',
    help: 'Um IPv6 ou uma faixa (CIDR).',
  },
  {
    id: 'URL',
    placeholder: 'https://portal.empresa.com.br/login',
    help: 'Só este link. Para o site inteiro, permita o domínio.',
  },
  { id: 'EMAIL', placeholder: 'avisos@empresa.com.br', help: 'Endereço exato.' },
  { id: 'SHA256', placeholder: '64 caracteres hexadecimais', help: 'Arquivo legítimo conhecido.' },
  { id: 'SHA1', placeholder: '40 caracteres hexadecimais', help: 'Arquivo legítimo conhecido.' },
  { id: 'MD5', placeholder: '32 caracteres hexadecimais', help: 'Arquivo legítimo conhecido.' },
];

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
      label: 'Indicador',
      ok: form.value.trim().length > 0,
      api: 'value',
      value: form.value,
    },
    {
      id: 'allow-reason',
      label: 'Motivo (mínimo de 3 caracteres)',
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
      title: 'Remover da lista de permissões',
      message: `Remover ${item.value}? Ele volta a ligar amostras, gerar alertas e aparecer nas sugestões.`,
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/allowlist/${item.id}`);
      await queryClient.invalidateQueries({ queryKey: ['allowlist'] });
      setNotice({ ok: true, text: `${item.value} removido da lista de permissões.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      <HpsmToolbar label="Ações da lista de permissões">
        <HpsmToolbarButton
          label={busy ? 'Incluindo...' : 'Incluir'}
          title="Incluir (Ctrl+S)"
          icon={IconAdd}
          disabled={busy}
          onClick={() => void add()}
        />
        <HpsmToolbarButton
          label="Importar…"
          title="Importar uma lista (CSV) ou um pacote STIX 2.1"
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
      <PageHeader
        title="Indicadores permitidos"
        subtitle="Legítimos conhecidos: não ligam amostras nas Relacionadas, não geram alertas de IOC e somem dos IOCs sugeridos. O que for escrito no relatório não muda."
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      <HpsmSection title="Incluir indicador">
        <HpsmForm columns={2}>
          <HpsmField label="Tipo" htmlFor="allow-kind">
            <Select
              id="allow-kind"
              labelText="Tipo"
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
            label="Indicador"
            htmlFor="allow-value"
            required
            help={kind.help}
            invalid={check.isInvalid('allow-value')}
          >
            <TextInput
              id="allow-value"
              labelText="Indicador"
              hideLabel
              placeholder={kind.placeholder}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          </HpsmField>
          <HpsmField
            label="Motivo"
            htmlFor="allow-reason"
            required
            wide
            invalid={check.isInvalid('allow-reason')}
          >
            <TextInput
              id="allow-reason"
              labelText="Motivo"
              hideLabel
              placeholder="Ex.: domínio da empresa; CDN oficial do fornecedor"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      {query.isLoading && <HpsmLoading text="Carregando a lista..." />}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">Nenhum indicador permitido ainda.</HpsmMessage>
      )}
      {items.length > 0 && (
        <TableContainer className="dl-mt-lg">
          <Table size="xs" aria-label="Indicadores permitidos">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Tipo</TableHeader>
                <TableHeader scope="col">Indicador</TableHeader>
                <TableHeader scope="col">Motivo</TableHeader>
                <TableHeader scope="col">Incluído</TableHeader>
                <TableHeader scope="col">Ações</TableHeader>
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
                    {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                    {item.createdBy ? ` por ${item.createdBy.displayName}` : ''}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      kind="danger--tertiary"
                      aria-label={`Remover ${item.value}`}
                      onClick={() => void remove(item)}
                    >
                      Remover
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
