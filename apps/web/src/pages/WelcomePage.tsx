import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useOwnSamplesOnly } from '../auth/sampleAccess';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { SHORTCUT_GROUPS, ShortcutKeys } from '../components/shortcutList';
import { VerdictTag } from '../components/tags';
import { useTakeNext } from '../components/useTakeNext';
import { intlLocale } from '../i18n';
import { t } from '../i18n/misc';

interface Updates {
  since: string | null;
  completed: { entryId: string; title: string; verdict: Verdict; completedAt: string }[];
}

/** Pagina inicial do app logado: texto introdutorio de boas-vindas. */
/** Atalhos resumidos nas Dicas (a lista completa abre com ? ou F1). */
// Funcao, e nao constante: os rotulos acompanham o idioma.
const tipShortcuts = () =>
  SHORTCUT_GROUPS.flatMap((group) => group.items).filter((item) => item.tip);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function WelcomePage() {
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const ownOnly = useOwnSamplesOnly();
  const next = useTakeNext();

  // Amostras do usuario concluidas desde a visita anterior.
  const updatesQuery = useQuery({
    queryKey: ['me', 'updates'],
    queryFn: () => api.get<Updates>('/me/updates'),
  });
  const completed = updatesQuery.data?.completed ?? [];

  return (
    <>
      <PageHeader
        title={t('home')}
        subtitle={user ? t('welcomeUser', { name: user.displayName }) : undefined}
      />

      {completed.length > 0 && (
        <HpsmMessage kind="info">
          {completed.length === 1 ? t('doneOne') : t('doneMany', { n: completed.length })}
        </HpsmMessage>
      )}
      {next.notice && (
        <HpsmMessage key={next.notice.text} kind={next.notice.kind}>
          {next.notice.text}
        </HpsmMessage>
      )}

      <div className="dl-welcome">
        {completed.length > 0 && (
          <HpsmSection title={t('newsSince')}>
            <TableContainer>
              <Table size="xs" aria-label={t('doneSinceAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('sample')}</TableHeader>
                    <TableHeader scope="col">{t('verdict')}</TableHeader>
                    <TableHeader scope="col">{t('completedAt')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {completed.map((item) => (
                    <TableRow key={item.entryId}>
                      <TableCell>
                        <Link className="dl-link" to={`/entries/${item.entryId}`}>
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <VerdictTag verdict={item.verdict} />
                      </TableCell>
                      <TableCell>
                        {new Date(item.completedAt).toLocaleString(intlLocale())}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </HpsmSection>
        )}

        <HpsmSection title={t('welcomeTitle')}>
          <p>
            {t('welcomeIntro').split('{brand}')[0]}
            <strong>DeepLook</strong>
            {t('welcomeIntro').split('{brand}')[1]}
          </p>
        </HpsmSection>

        <HpsmSection title={t('whereToStart')}>
          <ul>
            <li>
              <Link className="dl-link" to="/submit">
                {t('submitSample')}
              </Link>{' '}
              {t('submitHint')}
            </li>
            <li>
              <Link className="dl-link" to="/me">
                {t('myUploads')}
              </Link>{' '}
              {t('myUploadsHint')}
            </li>
            {!ownOnly && (
              <li>
                <Link className="dl-link" to="/history">
                  {t('history')}
                </Link>{' '}
                {t('historyHint')}
              </li>
            )}
            {canTriage && (
              <li>
                {t('inTab')} <strong>{t('analysisTab')}</strong> {t('analysisHint')}
              </li>
            )}
            {canTriage && (
              <li>
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={next.taking}
                  onClick={() => void next.take()}
                >
                  {next.taking ? t('taking') : t('takeNext')}
                </button>{' '}
                {t('takeNextHint')}
              </li>
            )}
          </ul>
        </HpsmSection>

        {!canTriage && (
          <HpsmSection title={t('clickedTitle')}>
            <ul>
              <li>{t('clickedLink')}</li>
              <li>{t('openedAttachment')}</li>
              <li>
                {t('then')}{' '}
                <Link className="dl-link" to="/submit">
                  {t('sendSample')}
                </Link>{' '}
                {t('toSecurity')}
              </li>
            </ul>
          </HpsmSection>
        )}

        <HpsmSection title={t('tips')}>
          <ul>
            <li>
              {t('use')} <strong>{t('navigator')}</strong>
              {t('navigatorHint')}
            </li>
            <li>
              {t('clickName')}{' '}
              <Link className="dl-link" to="/user">
                {t('myAccount')}
              </Link>{' '}
              {t('myAccountHint')}
            </li>
            {canTriage && (
              <li>
                {t('shortcuts')}{' '}
                {tipShortcuts().map((item, index) => (
                  <Fragment key={item.label}>
                    {index > 0 && ', '}
                    <ShortcutKeys keys={item.keys} /> {lowerFirst(item.label)}
                  </Fragment>
                ))}
                {t('press')} <ShortcutKeys keys={[['?'], ['F1']]} /> {t('seeAllShortcuts')}
              </li>
            )}
            <li>{t('maliciousWarning')}</li>
          </ul>
        </HpsmSection>
      </div>
    </>
  );
}
