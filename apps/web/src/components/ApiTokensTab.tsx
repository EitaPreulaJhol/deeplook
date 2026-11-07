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
export const SCOPE_LABEL: Record<ApiTokenScope, string> = {
  SAMPLES: 'Amostras',
  STATUS: 'Status (monitor)',
  FEED: 'Feed de indicadores',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Situacao de um token: ativo, vencido ou revogado. */
export function tokenState(t: ApiToken): { label: string; tone: StatusTone } {
  if (t.revokedAt) return { label: 'Revogado', tone: 'gray' };
  if (new Date(t.expiresAt).getTime() <= Date.now()) return { label: 'Vencido', tone: 'orange' };
  return { label: 'Ativo', tone: 'green' };
}

/** "dd/mm/aaaa hh:mm · 203.0.113.9" ou "Nunca usado". */
export function lastUse(t: ApiToken): string {
  if (!t.lastUsedAt) return 'Nunca usado';
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
    { id: 'token-name', label: 'Nome', ok: name.trim().length >= 2, api: 'name', value: name },
    { id: 'token-days', label: 'Validade', ok: true, api: 'expiresInDays', value: days },
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
      title: 'Revogar token',
      message: `O token "${t.name}" deixa de funcionar imediatamente. Scripts que o usam vão receber 401.`,
      confirmLabel: 'Revogar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/me/api-tokens/${t.id}`);
      await queryClient.invalidateQueries({ queryKey: ['me', 'api-tokens'] });
      setNotice({ ok: true, text: `Token "${t.name}" revogado.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  if (query.isLoading) return <HpsmLoading text="Carregando tokens..." />;
  if (query.isError) {
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  }
  const tokens = query.data?.tokens ?? [];
  const origin = window.location.origin;

  return (
    <>
      <HpsmToolbar label="Ações dos tokens">
        <HpsmToolbarButton
          label={creating ? 'Gerando...' : 'Gerar token'}
          title="Gerar token (Ctrl+S)"
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
          Token "{secret.name}": <span className="dl-mono">{secret.value}</span>
          <CopyButton value={secret.value} label="token" /> — copie agora; ele não será mostrado de
          novo.
        </HpsmMessage>
      )}

      <HpsmSection title="Novo token" className="dl-form-col">
        <HpsmForm>
          <HpsmField
            label="Nome"
            htmlFor="token-name"
            required
            invalid={check.isInvalid('token-name')}
            help="Para lembrar onde ele é usado (ex.: coletor do SIEM)."
          >
            <TextInput
              id="token-name"
              labelText="Nome"
              hideLabel
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </HpsmField>
          {isAdmin && (
            <HpsmField
              label="Finalidade"
              htmlFor="token-scope"
              help={
                scope === 'STATUS'
                  ? 'Só lê o status do sistema (GET /api/status), para Uptime Kuma, Zabbix e similares. Não alcança amostras nem a administração.'
                  : scope === 'FEED'
                    ? 'Só lê os indicadores de amostras maliciosas e suspeitas (sem a lista de permitidos nem os domínios da empresa), por TAXII 2.1 e feed MISP, para um TIP ou SIEM buscar sozinho.'
                    : 'Envio e consulta de amostras, como nos exemplos abaixo.'
              }
            >
              <Select
                id="token-scope"
                labelText="Finalidade"
                hideLabel
                value={scope}
                onChange={(e) => setScope(e.target.value as ApiTokenScope)}
              >
                <SelectItem value="SAMPLES" text="Envio e consulta de amostras" />
                <SelectItem value="STATUS" text="Monitoramento: só ler o status do sistema" />
                <SelectItem
                  value="FEED"
                  text="Feed de indicadores: TAXII 2.1 e MISP (OpenCTI, Sentinel, MISP)"
                />
              </Select>
            </HpsmField>
          )}
          <HpsmField label="Validade" htmlFor="token-days" invalid={check.isInvalid('token-days')}>
            <Select
              id="token-days"
              labelText="Validade"
              hideLabel
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {VALIDITY.map((d) => (
                <SelectItem key={d} value={String(d)} text={`${d} dias`} />
              ))}
            </Select>
          </HpsmField>
          <HpsmField label="Uso" top>
            <HpsmReadonly mono multiline>
              {scope === 'STATUS'
                ? `curl -H "Authorization: Bearer <token>" "${origin}/api/status"\n` +
                  `curl -H "Authorization: Bearer <token>" "${origin}/api/status?strict=1"   # 503 se algo estiver fora do ar`
                : scope === 'FEED'
                  ? `TAXII 2.1: ${origin}/api/taxii2/   (Bearer <token>, ou Basic com qualquer usuário e o token como senha)\n` +
                    `MISP: Sync Actions > Feeds > Add Feed, formato "MISP Feed", URL ${origin}/api/feeds/misp\n` +
                    `      e em Headers: Authorization: Bearer <token>\n` +
                    `curl -H "Authorization: Bearer <token>" "${origin}/api/taxii2/deeplook/collections/"`
                  : `curl -H "Authorization: Bearer <token>" "${origin}/api/entries?scope=mine"\n` +
                    `curl -H "Authorization: Bearer <token>" -F file=@amostra.exe "${origin}/api/entries/file"`}
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Documentação">
            <HpsmReadonly>
              <Link className="dl-link" to="/user/api">
                Documentação da API
              </Link>{' '}
              (rotas, campos, exemplos e a especificação OpenAPI)
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Permite">
            <HpsmReadonly>
              {scope === 'FEED'
                ? 'Ler a coleção TAXII e o feed MISP de indicadores. Não alcança amostras, arquivos, relatórios nem a administração; para de valer se o dono deixar de ser administrador.'
                : 'Enviar arquivos, .zip e links, listar e consultar amostras, relatórios, histórico e IOCs. Não baixa arquivos nem altera triagem, relatórios ou a conta.'}
            </HpsmReadonly>
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      <HpsmSection title={`Meus tokens (${tokens.length})`}>
        {tokens.length === 0 ? (
          <p className="dl-static-empty">Nenhum token gerado.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Meus tokens">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Nome</TableHeader>
                  <TableHeader scope="col">Finalidade</TableHeader>
                  <TableHeader scope="col">Início</TableHeader>
                  <TableHeader scope="col">Criado em</TableHeader>
                  <TableHeader scope="col">Expira em</TableHeader>
                  <TableHeader scope="col">Último uso</TableHeader>
                  <TableHeader scope="col">Situação</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
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
                            Revogar…
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
