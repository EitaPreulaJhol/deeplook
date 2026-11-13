import {
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
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ApiToken, ApiTokenScope } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { intlLocale, localized } from '../i18n';
import { t as tr } from '../i18n/account';
import { CopyButton } from './CopyButton';
import { useConfirm } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconKey } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const VALIDITY = [7, 30, 60, 90];

/**
 * Finalidade do token (itens 3.2 e 5.3); a de monitoramento e a do feed de indicadores so
 * aparecem para administradores.
 */
export const SCOPE_LABEL: Record<ApiTokenScope, string> = localized(() => ({
  SAMPLES: tr('scopeSamples'),
  STATUS: tr('scopeStatus'),
  FEED: tr('scopeFeed'),
}));

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** Situacao de um token: ativo, vencido ou revogado. */
export function tokenState(t: ApiToken): { label: string; tone: StatusTone } {
  if (t.revokedAt) return { label: tr('revoked'), tone: 'gray' };
  if (new Date(t.expiresAt).getTime() <= Date.now())
    return { label: tr('expired'), tone: 'orange' };
  return { label: tr('activeTok'), tone: 'green' };
}

/** "dd/mm/aaaa hh:mm · 203.0.113.9" ou "Nunca usado". */
export function lastUse(t: ApiToken): string {
  if (!t.lastUsedAt) return tr('neverUsed');
  return `${fmtDate(t.lastUsedAt)}${t.lastUsedIp ? ` · ${t.lastUsedIp}` : ''}`;
}

/**
 * Minha Conta > Tokens de API (so aparece com o "Acesso por API" liberado por
 * um admin). Gera token com nome e validade; ele aparece uma unica vez.
 */
export function ApiTokensTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [scope, setScope] = useState<ApiTokenScope>('SAMPLES');
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const query = useQuery({
    queryKey: ['me', 'api-tokens'],
    queryFn: () =>
      api.get<{ apiAccess: boolean; maxDays: number; tokens: ApiToken[] }>('/me/api-tokens'),
  });

  const check = useRequiredFields([
    { id: 'token-name', label: tr('name'), ok: name.trim().length >= 2, api: 'name', value: name },
    { id: 'token-days', label: tr('validity'), ok: true, api: 'expiresInDays', value: days },
  ]);

  const create = async () => {
    setNotice(null);
    setSecret(null);
    if (!check.check()) return;
    setCreating(true);
    try {
      const res = await api.post<{ token: ApiToken; secret: string }>('/me/api-tokens', {
        name: name.trim(),
        expiresInDays: Number(days),
        scope,
      });
      setSecret({ name: res.token.name, value: res.secret });
      setName('');
      check.reset();
      await queryClient.invalidateQueries({ queryKey: ['me', 'api-tokens'] });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };
  useSaveShortcut(create, !creating);

  const revoke = async (t: ApiToken) => {
    const ok = await confirm({
      title: tr('revokeToken'),
      message: tr('revokeTokenMsg', { name: t.name }),
      confirmLabel: tr('revoke'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/me/api-tokens/${t.id}`);
      await queryClient.invalidateQueries({ queryKey: ['me', 'api-tokens'] });
      setNotice({ ok: true, text: tr('tokenRevoked', { name: t.name }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  if (query.isLoading) return <HpsmLoading text={tr('loadingTokens')} />;
  if (query.isError) {
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  }
  const tokens = query.data?.tokens ?? [];
  const origin = window.location.origin;

  return (
    <>
      <HpsmToolbar label={tr('tokenActions')}>
        <HpsmToolbarButton
          label={creating ? tr('generating') : tr('generateToken')}
          title={tr('generateTokenHint')}
          icon={IconKey}
          disabled={creating}
          onClick={create}
        />
      </HpsmToolbar>
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {secret && (
        <HpsmMessage kind="success">
          {tr('tokenSecret', { name: secret.name })} <span className="dl-mono">{secret.value}</span>
          <CopyButton value={secret.value} label="token" /> {tr('copyNow')}
        </HpsmMessage>
      )}

      <HpsmSection title={tr('newToken')} className="dl-form-col">
        <HpsmForm>
          <HpsmField
            label={tr('name')}
            htmlFor="token-name"
            required
            invalid={check.isInvalid('token-name')}
            help={tr('tokenNameHelp')}
          >
            <TextInput
              id="token-name"
              labelText={tr('name')}
              hideLabel
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </HpsmField>
          {isAdmin && (
            <HpsmField
              label={tr('purpose')}
              htmlFor="token-scope"
              help={
                scope === 'STATUS'
                  ? tr('scopeStatusHelp')
                  : scope === 'FEED'
                    ? tr('scopeFeedHelp')
                    : tr('scopeSamplesHelp')
              }
            >
              <Select
                id="token-scope"
                labelText={tr('purpose')}
                hideLabel
                value={scope}
                onChange={(e) => setScope(e.target.value as ApiTokenScope)}
              >
                <SelectItem value="SAMPLES" text={tr('scopeSamplesOpt')} />
                <SelectItem value="STATUS" text={tr('scopeStatusOpt')} />
                <SelectItem value="FEED" text={tr('scopeFeedOpt')} />
              </Select>
            </HpsmField>
          )}
          <HpsmField
            label={tr('validity')}
            htmlFor="token-days"
            invalid={check.isInvalid('token-days')}
          >
            <Select
              id="token-days"
              labelText={tr('validity')}
              hideLabel
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {VALIDITY.map((d) => (
                <SelectItem key={d} value={String(d)} text={`${d} dias`} />
              ))}
            </Select>
          </HpsmField>
          <HpsmField label={tr('usage')} top>
            <HpsmReadonly mono multiline>
              {scope === 'STATUS'
                ? `curl -H "Authorization: Bearer <token>" "${origin}/api/status"\n` +
                  `curl -H "Authorization: Bearer <token>" "${origin}/api/status?strict=1"   # ${tr('curl503')}`
                : scope === 'FEED'
                  ? `TAXII 2.1: ${origin}/api/taxii2/   (${tr('taxiiAuth')})\n` +
                    `MISP: Sync Actions > Feeds > Add Feed, ${tr('mispFormat')}, URL ${origin}/api/feeds/misp\n` +
                    `      ${tr('mispHeaders')}: Authorization: Bearer <token>\n` +
                    `curl -H "Authorization: Bearer <token>" "${origin}/api/taxii2/deeplook/collections/"`
                  : `curl -H "Authorization: Bearer <token>" "${origin}/api/entries?scope=mine"\n` +
                    `curl -H "Authorization: Bearer <token>" -F file=@${tr('sampleExe')} "${origin}/api/entries/file"`}
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label={tr('documentation')}>
            <HpsmReadonly>
              <Link className="dl-link" to="/user/api">
                {tr('apiDocs')}
              </Link>{' '}
              {tr('apiDocsHint')}
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label={tr('allows')}>
            <HpsmReadonly>{scope === 'FEED' ? tr('feedAllows') : tr('samplesAllows')}</HpsmReadonly>
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      <HpsmSection title={tr('myTokensN', { n: tokens.length })}>
        {tokens.length === 0 ? (
          <p className="dl-static-empty">{tr('noTokens')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={tr('myTokens')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{tr('name')}</TableHeader>
                  <TableHeader scope="col">{tr('purpose')}</TableHeader>
                  <TableHeader scope="col">{tr('prefix')}</TableHeader>
                  <TableHeader scope="col">{tr('createdOn')}</TableHeader>
                  <TableHeader scope="col">{tr('expiresAt')}</TableHeader>
                  <TableHeader scope="col">{tr('lastUse')}</TableHeader>
                  <TableHeader scope="col">{tr('situation')}</TableHeader>
                  <TableHeader scope="col">{tr('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {tokens.map((t) => {
                  const state = tokenState(t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell>{SCOPE_LABEL[t.scope]}</TableCell>
                      <TableCell>
                        <span className="dl-mono">{t.prefix}…</span>
                      </TableCell>
                      <TableCell>{fmtDate(t.createdAt)}</TableCell>
                      <TableCell>{fmtDate(t.expiresAt)}</TableCell>
                      <TableCell>{lastUse(t)}</TableCell>
                      <TableCell>
                        <StatusText tone={state.tone}>{state.label}</StatusText>
                      </TableCell>
                      <TableCell>
                        {state.label === 'Ativo' ? (
                          <button
                            type="button"
                            className="dl-link-button dl-link-button--danger"
                            onClick={() => void revoke(t)}
                          >
                            {tr('revokeEllipsis')}
                          </button>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
