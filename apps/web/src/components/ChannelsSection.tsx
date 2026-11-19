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

import { api } from '../api/client';
import { localized } from '../i18n';
import { t } from '../i18n/analysis';
import { CopyButton } from './CopyButton';
import { HpsmSection } from './HpsmForm';
import { StatusText } from './tags';

/** Um canal de exfiltracao (GET /api/entries/:id/channels; plans/analise-estatica-ampliada, item 3). */
export interface Channel {
  kind: string;
  value: string;
  host: string | null;
  credential: boolean;
  source: string;
}

const KINDS: Record<string, string> = localized(() => ({
  'telegram-bot': t('chTelegramBot'),
  'telegram-chat': t('chTelegramChat'),
  'discord-webhook': t('chDiscord'),
  'slack-webhook': t('chSlack'),
  webhook: t('chWebhook'),
  smtp: t('chSmtp'),
  'smtp-credential': t('chSmtpCredential'),
  ftp: 'FTP',
  paste: t('chPaste'),
  tunnel: t('chTunnel'),
  'cloud-key': t('chCloudKey'),
}));

const SOURCES: Record<string, string> = localized(() => ({
  strings: t('chFromStrings'),
  script: t('chFromScript'),
  floss: 'FLOSS',
  dotnet: t('chFromDotnet'),
  jar: t('chFromJar'),
  emulation: t('chFromEmulation'),
  config: t('chFromConfig'),
}));

/**
 * Secao "Canais de exfiltracao": para onde a amostra manda dados e com que credencial (token do
 * bot do Telegram, webhook do Discord, SMTP, FTP...), de todas as analises. Some sem achados.
 */
export function ChannelsSection({ entryId }: { entryId: string }) {
  const query = useQuery({
    queryKey: ['entry', entryId, 'channels'],
    queryFn: () =>
      api.get<{ channels: Channel[]; masked: boolean }>(`/entries/${entryId}/channels`),
  });
  const channels = query.data?.channels ?? [];
  if (!channels.length) return null;
  return (
    <HpsmSection title={t('chTitle')}>
      <p className="dl-static-empty">
        {t('chIntro')} {query.data?.masked && t('chMasked')}
      </p>
      <TableContainer>
        <Table size="xs" aria-label={t('chTitle')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('chKind')}</TableHeader>
              <TableHeader scope="col">{t('chValue')}</TableHeader>
              <TableHeader scope="col">{t('chSource')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {channels.map((c) => (
              <TableRow key={`${c.kind}-${c.value}`}>
                <TableCell>
                  {c.credential ? (
                    <StatusText tone="red">{KINDS[c.kind] ?? c.kind}</StatusText>
                  ) : (
                    (KINDS[c.kind] ?? c.kind)
                  )}
                </TableCell>
                <TableCell>
                  <code>{c.value}</code>
                  {!query.data?.masked && (
                    <>
                      {' '}
                      <CopyButton value={c.value} label={KINDS[c.kind] ?? c.kind} />
                    </>
                  )}
                </TableCell>
                <TableCell>{SOURCES[c.source] ?? c.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </HpsmSection>
  );
}
