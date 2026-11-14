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
import { t } from '../i18n/detection';
import { useConfirm } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmLoading } from './messages';
import {
  EffectivenessCells,
  EffectivenessHeaders,
  NeverFiredFilter,
  type RuleEffectiveness,
  useRuleEffectiveness,
} from './RuleEffectiveness';
import { StatusText } from './tags';

type PackRule = Pick<YaraRule, 'id' | 'name' | 'enabled' | 'pack'> & {
  effectiveness?: RuleEffectiveness;
};

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
      api.get<{ total: number; limit: number; rules: PackRule[]; effectivenessDays?: number }>(
        `/yara/packs/${openPack}/rules?q=${encodeURIComponent(q.trim())}`,
      ),
    enabled: Boolean(openPack),
  });
  // Eficacia (plano pos-revisao, item 2.3).
  const days = rulesQuery.data?.effectivenessDays ?? 90;
  const effectiveness = useRuleEffectiveness(rulesQuery.data?.rules ?? []);

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
      t(rule.enabled ? 'yaraDisabled' : 'yaraEnabled', { name: rule.name }),
    );
  const remove = async (rule: PackRule) => {
    const ok = await confirm({
      title: t('deletePackRule'),
      message: t('deletePackRuleConfirm', { name: rule.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    if (reading?.id === rule.id) setReading(null);
    await run(() => api.del(`/yara/rules/${rule.id}`), t('ruleDeleted', { name: rule.name }));
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
    <HpsmSection title={t('packsTitle')}>
      {packsQuery.isLoading && <HpsmLoading text={t('loadingPacks')} />}
      <TableContainer>
        <Table size="xs" aria-label={t('packsAria')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('pack')}</TableHeader>
              <TableHeader scope="col">{t('author')}</TableHeader>
              <TableHeader scope="col">{t('license')}</TableHeader>
              <TableHeader scope="col">{t('activeSets')}</TableHeader>
              <TableHeader scope="col">{t('situation')}</TableHeader>
              <TableHeader scope="col">{t('actions')}</TableHeader>
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
                    {pack.enabled ? t('onM') : t('offM')}
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
                      {openPack === pack.id ? t('closeRules') : t('viewRules')}
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <p className="dl-static-empty">
        {t('packToggleWhere')}{' '}
        {user?.role === 'ADMIN' ? (
          <Link className="dl-link" to="/admin?tab=settings">
            {t('adminSettings')}
          </Link>
        ) : (
          t('adminSettingsOnly')
        )}
        .
      </p>

      {openPack && (
        <>
          <HpsmForm>
            <HpsmField
              label={t('searchPackRule')}
              htmlFor="yara-pack-search"
              help={
                rulesQuery.data &&
                (rulesQuery.data.total > rulesQuery.data.rules.length
                  ? t('showingNofTotal', {
                      n: rulesQuery.data.rules.length,
                      total: rulesQuery.data.total,
                    })
                  : t('setsN', { n: rulesQuery.data.total }))
              }
            >
              <TextInput
                id="yara-pack-search"
                labelText={t('searchPackRule')}
                hideLabel
                size="sm"
                placeholder={t('searchPackPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </HpsmField>
          </HpsmForm>
          <NeverFiredFilter
            id="yara-pack-never-fired"
            days={days}
            checked={effectiveness.neverOnly}
            count={effectiveness.never}
            onChange={effectiveness.setNeverOnly}
          />
          <TableContainer>
            <Table size="xs" aria-label={t('packRulesAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('set')}</TableHeader>
                  <TableHeader scope="col">{t('situation')}</TableHeader>
                  <EffectivenessHeaders
                    days={days}
                    sort={effectiveness.sort}
                    onSort={effectiveness.toggle}
                  />
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {effectiveness.rows.map((rule) => (
                  <TableRow key={rule.id} className={rule.enabled ? undefined : 'is-off'}>
                    <TableCell>
                      <span className="dl-cell-text" title={rule.name}>
                        {rule.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusText tone={rule.enabled ? 'green' : 'gray'}>
                        {rule.enabled ? t('active') : t('inactive')}
                      </StatusText>
                    </TableCell>
                    <EffectivenessCells value={rule.effectiveness} />
                    <TableCell>
                      <span className="dl-row-actions">
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void read(rule)}
                        >
                          {t('read')}
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void toggle(rule)}
                        >
                          {rule.enabled ? t('disable') : t('enable')}
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={retroRunning}
                          onClick={() => onRetro(rule)}
                        >
                          {t('applyToSamples')}
                        </button>
                        <button
                          type="button"
                          className="dl-link-button"
                          onClick={() => void remove(rule)}
                        >
                          {t('delete')}
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
