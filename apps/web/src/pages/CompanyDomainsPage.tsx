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
      label: 'Domínio',
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
      return `${res.item.domain} incluído e posto na lista de permissões. As amostras estão sendo revistas.`;
    });
  };

  const remove = async (d: CompanyDomain) => {
    const ok = await confirm({
      title: 'Excluir domínio da empresa',
      message: `Excluir ${d.domain}? Ele sai da lista de permissões e os parecidos com ele deixam de ser marcados.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/company-domains/${d.id}`);
      return `${d.domain} excluído.`;
    });
  };

  const data = query.data;
  return (
    <>
      <PageHeader
        title="Domínios da empresa"
        subtitle="Links, remetentes e indicadores parecidos com os domínios da empresa (outro TLD, letras parecidas, erro de digitação, palavra a mais, nome no subdomínio) são marcados nas amostras. Nada é consultado na internet."
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text="Carregando..." />}

      <HpsmSection title={`Domínios (${data?.domains.length ?? 0})`}>
        {data && data.domains.length === 0 && (
          <p className="dl-static-empty">
            Nenhum domínio cadastrado.
            {isAdmin ? '' : ' O administrador cadastra os domínios da empresa.'}
          </p>
        )}
        {data && data.domains.length > 0 && (
          <ul className="dl-company-domains">
            {data.domains.map((d) => (
              <li key={d.id}>
                <span className="dl-mono">{d.domain}</span>{' '}
                <span className="dl-company-domains__by">
                  por {d.createdBy?.displayName ?? '—'} em{' '}
                  {new Date(d.createdAt).toLocaleDateString(intlLocale())}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="dl-link-button"
                    disabled={busy}
                    onClick={() => void remove(d)}
                  >
                    Excluir
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && data && data.domains.length < data.max && (
          <HpsmForm>
            <HpsmField
              label="Novo domínio"
              htmlFor="company-domain"
              required
              invalid={check.isInvalid('company-domain')}
              help="O domínio registrado (ex.: empresa.com.br); os subdomínios valem junto."
            >
              <TextInput
                id="company-domain"
                labelText="Novo domínio"
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
                Incluir
              </button>
            </HpsmFormActions>
          </HpsmForm>
        )}
      </HpsmSection>

      <HpsmSection title={`Variações vistas (${data?.seen.length ?? 0})`} className="dl-mt-lg">
        {data && data.seen.length === 0 ? (
          <p className="dl-static-empty">Nenhum domínio parecido apareceu nas amostras.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Variações vistas">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Domínio visto</TableHeader>
                  <TableHeader scope="col">Parecido com</TableHeader>
                  <TableHeader scope="col">Motivo</TableHeader>
                  <TableHeader scope="col">Onde</TableHeader>
                  <TableHeader scope="col">Amostras</TableHeader>
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
