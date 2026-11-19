import {
  PasswordInput,
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
import { useAuth } from '../auth/AuthContext';
import { passkeyCancelled, passkeysSupported, registerPasskey } from '../auth/passkeys';
import { intlLocale } from '../i18n';
import { t } from '../i18n/account';
import { isSubmitEnter } from './enterKey';
import { useConfirm } from './HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmReadonly,
  HpsmSection,
  useRequiredFields,
} from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string;
  backedUp: boolean;
}

interface PasskeyList {
  passkeys: PasskeyRow[];
  max: number;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString(intlLocale());

/**
 * Minha Conta > Passkeys: login alternativo, sem senha. So se cadastra depois de entrar (a API pede
 * a senha de novo e, com 2FA, o codigo); a passkey vale por senha e segundo fator, entao entrar
 * com ela nao pede o codigo do 2FA.
 */
export function PasskeysTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const needsCode = Boolean(user?.twoFactorEnabled);

  const query = useQuery({
    queryKey: ['me', 'passkeys'],
    queryFn: () => api.get<PasskeyList>('/me/passkeys'),
  });
  const rows = query.data?.passkeys ?? [];
  const full = query.data ? rows.length >= query.data.max : false;

  const check = useRequiredFields([
    {
      id: 'pk-name',
      label: t('passkeyName'),
      ok: name.trim().length > 0,
      api: 'name',
      value: name,
    },
    {
      id: 'pk-password',
      label: t('currentPassword'),
      ok: password.length > 0,
      api: 'password',
      value: password,
    },
    ...(needsCode
      ? [
          {
            id: 'pk-code',
            label: t('code'),
            ok: code.trim().length >= 6,
            api: 'code',
            value: code,
          },
        ]
      : []),
  ]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['me', 'passkeys'] });

  const add = async () => {
    setNotice(null);
    if (!check.check()) return;
    setBusy(true);
    try {
      await registerPasskey({
        name: name.trim(),
        password,
        code: needsCode ? code.trim() : undefined,
      });
      setName('');
      setPassword('');
      setCode('');
      check.reset();
      setNotice({ ok: true, text: t('passkeyAdded') });
      await reload();
    } catch (err) {
      if (passkeyCancelled(err)) setNotice({ ok: false, text: t('passkeyCancelled') });
      else if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: PasskeyRow) => {
    const ok = await confirm({
      title: t('removePasskey'),
      message: t('removePasskeyConfirm', { name: row.name }),
      confirmLabel: t('remove'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    setNotice(null);
    setBusy(true);
    try {
      await api.del(`/me/passkeys/${row.id}`);
      setNotice({ ok: true, text: t('passkeyRemoved', { name: row.name }) });
      await reload();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const supported = passkeysSupported();

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={t('loadingPasskeys')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}

      <HpsmSection title={t('passkeysTitle')} className="dl-form-col">
        <HpsmForm>
          <HpsmField label={t('howItWorks')}>
            <HpsmReadonly multiline>{t('passkeysHow')}</HpsmReadonly>
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      <HpsmSection title={t('passkeysN', { n: rows.length })}>
        {query.data && rows.length === 0 && <p className="dl-static-empty">{t('noPasskeys')}</p>}
        {rows.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label={t('passkeysTitle')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('passkeyName')}</TableHeader>
                  <TableHeader scope="col">{t('passkeyKind')}</TableHeader>
                  <TableHeader scope="col">{t('passkeyCreated')}</TableHeader>
                  <TableHeader scope="col">{t('passkeyLastUsed')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      {row.deviceType === 'multiDevice' ? t('passkeySynced') : t('passkeyDevice')}
                    </TableCell>
                    <TableCell>{fmtDate(row.createdAt)}</TableCell>
                    <TableCell>
                      {row.lastUsedAt ? (
                        fmtDate(row.lastUsedAt)
                      ) : (
                        <StatusText tone="gray">{t('passkeyNeverUsed')}</StatusText>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="dl-link-button dl-link-button--danger"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        {t('removeEllipsis')}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>

      <HpsmSection title={t('addPasskey')} className="dl-form-col">
        {!supported && <HpsmMessage kind="warning">{t('passkeysUnsupported')}</HpsmMessage>}
        {supported && full && <HpsmMessage kind="info">{t('passkeysFull')}</HpsmMessage>}
        {supported && !full && (
          <HpsmForm>
            <HpsmField
              label={t('passkeyName')}
              htmlFor="pk-name"
              required
              help={t('passkeyNameHelp')}
              invalid={check.isInvalid('pk-name')}
            >
              <TextInput
                id="pk-name"
                labelText={t('passkeyName')}
                hideLabel
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </HpsmField>
            <HpsmField
              label={t('currentPassword')}
              htmlFor="pk-password"
              required
              help={t('passkeyPasswordHelp')}
              invalid={check.isInvalid('pk-password')}
            >
              <PasswordInput
                id="pk-password"
                labelText={t('currentPassword')}
                hideLabel
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (!needsCode && isSubmitEnter(e)) {
                    e.preventDefault();
                    void add();
                  }
                }}
              />
            </HpsmField>
            {needsCode && (
              <HpsmField
                label={t('code')}
                htmlFor="pk-code"
                required
                help={t('codeHelp')}
                invalid={check.isInvalid('pk-code')}
              >
                <TextInput
                  id="pk-code"
                  labelText={t('code')}
                  hideLabel
                  autoComplete="one-time-code"
                  maxLength={20}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (isSubmitEnter(e)) {
                      e.preventDefault();
                      void add();
                    }
                  }}
                />
              </HpsmField>
            )}
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={() => void add()}
              >
                {t('addPasskeyButton')}
              </button>
            </HpsmFormActions>
          </HpsmForm>
        )}
      </HpsmSection>
    </>
  );
}
