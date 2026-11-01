import {
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
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { YaraPack, YaraRule } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from './HpsmConfirm';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading } from './messages';
import { StatusText } from './tags';

type PackRule = Pick<YaraRule, 'id' | 'name' | 'enabled' | 'pack'>;

/**
 * Pacotes de regras de fontes confiaveis (item 143): as regras ficam fora da lista
 * da equipe e nao se editam, para nao perder a autoria; da para ler, desligar,
 * excluir e aplicar as amostras antigas. Ligar um pacote e na Administracao.
 */
export function YaraPacksSection({
  retroRunning,
  onRetro,
  onNotice,
}: {
  retroRunning: boolean;
  onRetro: (rule: Pick<YaraRule, 'id' | 'name'>) => void;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const packsQuery = useQuery({
    queryKey: ['yara-packs'],
    queryFn: () => api.get<{ packs: YaraPack[] }>('/yara/packs'),
  });
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [reading, setReading] = useState<YaraRule | null>(null);
  const rulesQuery = useQuery({
    queryKey: ['yara-pack-rules', openPack, q.trim()],
    queryFn: () =>
      api.get<{ total: number; limit: number; rules: PackRule[] }>(
        `/yara/packs/${openPack}/rules?q=${encodeURIComponent(q.trim())}`,
      ),
    enabled: Boolean(openPack),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['yara-packs'] }),
      queryClient.invalidateQueries({ queryKey: ['yara-pack-rules'] }),
    ]);
  const run = async (action: () => Promise<unknown>, text: string) => {
    try {
      await action();
      await refresh();
      onNotice({ ok: true, text });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    }
  };
  const toggle = (rule: PackRule) =>
    run(
      () => api.patch(`/yara/rules/${rule.id}`, { enabled: !rule.enabled }),
      `Regra "${rule.name}" ${rule.enabled ? 'desativada' : 'ativada'}.`,
    );
  const remove = async (rule: PackRule) => {
    const ok = await confirm({
      title: 'Excluir regra do pacote',
      message: `Excluir "${rule.name}"? Ela não volta sozinha. Para só parar de usar, desative.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    if (reading?.id === rule.id) setReading(null);
    await run(() => api.del(`/yara/rules/${rule.id}`), `Regra "${rule.name}" excluída.`);
  };
  const read = async (rule: PackRule) => {
    try {
      setReading((await api.get<{ rule: YaraRule }>(`/yara/rules/${rule.id}`)).rule);
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    }
  };

  const packs = packsQuery.data?.packs ?? [];
  return (
    <HpsmSection title="Pacotes de regras" className="dl-mt-lg">
      {packsQuery.isLoading && <HpsmLoading text="Carregando os pacotes..." />}
      <TableContainer>
        <Table size="xs" aria-label="Pacotes de regras YARA">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">Pacote</TableHeader>
              <TableHeader scope="col">Autor</TableHeader>
              <TableHeader scope="col">Licença</TableHeader>
              <TableHeader scope="col">Conjuntos ativos</TableHeader>
              <TableHeader scope="col">Situação</TableHeader>
              <TableHeader scope="col">Ações</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {packs.map((pack) => (
              <TableRow key={pack.id} className={pack.enabled ? undefined : 'is-off'}>
                <TableCell title={pack.description}>{pack.name}</TableCell>
                <TableCell>{pack.author}</TableCell>
                <TableCell>{pack.license}</TableCell>
                <TableCell>
                  {pack.installed ? `${pack.rulesActive} de ${pack.rulesTotal}` : '—'}
                </TableCell>
                <TableCell>
                  <StatusText tone={pack.enabled ? 'green' : 'gray'}>
                    {pack.enabled ? 'Ligado' : 'Desligado'}
                  </StatusText>
                </TableCell>
                <TableCell>
                  {pack.installed && (
                    <button
                      type="button"
                      className="dl-link-button"
                      aria-expanded={openPack === pack.id}
                      onClick={() => {
                        setOpenPack(openPack === pack.id ? null : pack.id);
                        setReading(null);
                        setQ('');
                      }}
                    >
                      {openPack === pack.id ? 'Fechar regras' : 'Ver regras'}
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <p className="dl-static-empty">
        Ligar e desligar um pacote fica em{' '}
        {user?.role === 'ADMIN' ? (
          <Link className="dl-link" to="/admin?tab=settings">
            Administração &gt; Configurações
          </Link>
        ) : (
          'Administração > Configurações (só administradores)'
        )}
        .
      </p>

      {openPack && (
        <>
          <TextInput
            id="yara-pack-search"
            labelText="Buscar regra do pacote"
            size="sm"
            placeholder="Nome do arquivo, ex.: ransomware"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {rulesQuery.data && (
            <p className="dl-static-empty">
              {rulesQuery.data.total > rulesQuery.data.rules.length
                ? `Mostrando ${rulesQuery.data.rules.length} de ${rulesQuery.data.total}. Busque para achar as demais.`
                : `${rulesQuery.data.total} conjunto(s).`}
            </p>
          )}
          <TableContainer>
            <Table size="xs" aria-label="Regras do pacote">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Conjunto</TableHeader>
                  <TableHeader scope="col">Situação</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {(rulesQuery.data?.rules ?? []).map((rule) => (
                  <TableRow key={rule.id} className={rule.enabled ? undefined : 'is-off'}>
                    <TableCell>
                      <span className="dl-cell-text" title={rule.name}>
                        {rule.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusText tone={rule.enabled ? 'green' : 'gray'}>
                        {rule.enabled ? 'Ativa' : 'Inativa'}
                      </StatusText>
                    </TableCell>
                    <TableCell>
                      <span className="dl-row-actions">
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void read(rule)}
                        >
                          Ler
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void toggle(rule)}
                        >
                          {rule.enabled ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={retroRunning}
                          onClick={() => onRetro(rule)}
                        >
                          Aplicar às amostras
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void remove(rule)}
                        >
                          Excluir
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

      {reading && (
        <div className="dl-compiler-output" data-ok="true">
          <strong>{reading.name}</strong>
          <pre>{reading.source}</pre>
        </div>
      )}
    </HpsmSection>
  );
}
