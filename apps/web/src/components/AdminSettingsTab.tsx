import { Checkbox } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { useConfirm } from './HpsmConfirm';
import { HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';

interface Settings {
  ownSamplesOnly: boolean;
}

/** Configuracoes do sistema feitas na tela (item 140); as demais vem do ambiente. */
export function AdminSettingsTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<Settings>('/admin/settings'),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (next: boolean) => {
    const ok = await confirm({
      title: next ? 'Restringir as amostras' : 'Abrir as amostras',
      message: next
        ? 'Usuários comuns passarão a ver e exportar só as amostras que eles mesmos enviaram, inclusive pela API. Analistas e administradores continuam vendo tudo.'
        : 'Usuários comuns voltarão a ver e exportar as amostras de todos.',
      confirmLabel: next ? 'Restringir' : 'Abrir',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.patch<Settings>('/admin/settings', { ownSamplesOnly: next });
      queryClient.setQueryData(['admin', 'settings'], saved);
      await queryClient.invalidateQueries({ queryKey: ['me', 'sample-access'] });
      setNotice({
        ok: true,
        text: next
          ? 'Usuários comuns agora veem só as próprias amostras.'
          : 'Usuários comuns voltaram a ver as amostras de todos.',
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text="Carregando as configurações..." />}
      {query.isError && (
        <HpsmMessage kind="error">Erro ao carregar: {(query.error as Error).message}</HpsmMessage>
      )}
      {query.data && (
        <HpsmSection title="Acesso às amostras" className="dl-form-col">
          <HpsmForm>
            <Checkbox
              id="setting-own-samples"
              labelText="Usuários comuns veem só as amostras que eles mesmos enviaram"
              helperText="Vale para listas, CSV, busca, indicadores, avisos e API. Analistas e administradores continuam vendo tudo. A mudança vale na hora e vai para a Auditoria."
              checked={query.data.ownSamplesOnly}
              disabled={busy}
              onChange={(_, { checked }) => void change(checked)}
            />
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
