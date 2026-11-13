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
import type { LookalikeHit, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { LOOKALIKE_SOURCE, lookalikeWhy } from '../components/LookalikeWarning';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { VerdictTag } from '../components/tags';
import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';

interface CompanyDomain {
  id: string;
  domain: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
}

interface Seen extends Omit<LookalikeHit, 'sources'> {
  sources: string[];
  total: number;
  lastSeen: string;
  entries: { id: string; title: string; verdict: Verdict }[];
}

/**
 * Dominios parecidos com os da empresa (item 92): o admin cadastra os dominios
 * (entram na lista de permissoes); analistas veem as variacoes ja vistas.
 */
export function CompanyDomainsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['company-domains'],
    queryFn: () =>
      api.get<{ domains: CompanyDomain[]; seen: Seen[]; max: number }>('/company-domains'),
  });
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const check = useRequiredFields([
    {
      id: 'company-domain',
      label: t('domain'),
      ok: domain.trim().length >= 3,
      api: 'domain',
      value: domain,
    },
  ]);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['company-domains'] });
      setNotice({ ok: true, text });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!check.check()) return;
    void run(async () => {
      const res = await api.post<{ item: CompanyDomain }>('/company-domains', { domain });
      setDomain('');
      check.reset();
      return t('domainAdded', { domain: res.item.domain });
    });
  };

  const remove = async (d: CompanyDomain) => {
    const ok = await confirm({
      title: t('deleteCompanyDomain'),
      message: t('deleteDomainConfirm', { domain: d.domain }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/company-domains/${d.id}`);
      return t('domainDeleted', { domain: d.domain });
    });
  };

  const data = query.data;
  return (
    <>
      <PageHeader title={t('cdTitle')} subtitle={t('cdSubtitle')} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={t('loadingDots')} />}

      <HpsmSection title={t('domainsN', { n: data?.domains.length ?? 0 })}>
        {data && data.domains.length === 0 && (
          <p className="dl-static-empty">
            {t('noDomains')}
            {isAdmin ? '' : ` ${t('adminRegisters')}`}
          </p>
        )}
        {data && data.domains.length > 0 && (
          <ul className="dl-company-domains">
            {data.domains.map((d) => (
              <li key={d.id}>
                <span className="dl-mono">{d.domain}</span>{' '}
                <span className="dl-company-domains__by">
                  {t('byOn', {
                    name: d.createdBy?.displayName ?? '—',
                    date: new Date(d.createdAt).toLocaleDateString(intlLocale()),
                  })}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="dl-link-button"
                    disabled={busy}
                    onClick={() => void remove(d)}
                  >
                    {t('delete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && data && data.domains.length < data.max && (
          <HpsmForm>
            <HpsmField
              label={t('newDomain')}
              htmlFor="company-domain"
              required
              invalid={check.isInvalid('company-domain')}
              help={t('newDomainHelp')}
            >
              <TextInput
                id="company-domain"
                labelText={t('newDomain')}
                hideLabel
                placeholder="empresa.com.br"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                }}
              />
            </HpsmField>
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={add}
              >
                {t('add')}
              </button>
            </HpsmFormActions>
          </HpsmForm>
        )}
      </HpsmSection>

      <HpsmSection title={t('seenN', { n: data?.seen.length ?? 0 })} className="dl-mt-lg">
        {data && data.seen.length === 0 ? (
          <p className="dl-static-empty">{t('noneSeen')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={t('seenAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('seenDomain')}</TableHeader>
                  <TableHeader scope="col">{t('similarTo')}</TableHeader>
                  <TableHeader scope="col">{t('reason')}</TableHeader>
                  <TableHeader scope="col">{t('where')}</TableHeader>
                  <TableHeader scope="col">{t('samples')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.seen ?? []).map((s) => (
                  <TableRow key={s.domain}>
                    <TableCell className="dl-mono">{s.domain}</TableCell>
                    <TableCell className="dl-mono">{s.companyDomain}</TableCell>
                    <TableCell>{lookalikeWhy(s)}</TableCell>
                    <TableCell>
                      {s.sources.map((x) => LOOKALIKE_SOURCE[x] ?? x).join(', ')}
                    </TableCell>
                    <TableCell>
                      {s.entries.map((e, i) => (
                        <span key={e.id}>
                          {i > 0 && ', '}
                          <Link className="dl-link" to={`/entries/${e.id}`}>
                            {e.title}
                          </Link>{' '}
                          <VerdictTag verdict={e.verdict} />
                        </span>
                      ))}
                      {s.total > s.entries.length && ` (+${s.total - s.entries.length})`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
