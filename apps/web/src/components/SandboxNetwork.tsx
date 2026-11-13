import type { SandboxNetwork as Network } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { HpsmMessage } from './messages';
import { ArtifactTable } from './SandboxSysmon';

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(intlLocale()) : '—';
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
const fmtBytes = (n: number | null) =>
  n === null
    ? '—'
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : `${(n / 1048576).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} MB`;
const SEVERITY: Record<number, 'sevHigh' | 'sevMedium' | 'sevLow'> = {
  1: 'sevHigh',
  2: 'sevMedium',
  3: 'sevLow',
};

/**
 * Trafego de rede do ambiente (plano pos-revisao, item 5.4): o pcap que o sniffer do MikroTik
 * mandou ao netcap, para baixar, e o que o Suricata (ET Open) achou nele: alertas, DNS, HTTP e TLS.
 */
export function SandboxNetwork({ sessionId, network }: { sessionId: string; network: Network }) {
  const ids = network.ids;
  const result = ids?.result;
  return (
    <div className="dl-sysmon dl-network">
      <h4>{t('netTitle')}</h4>
      {network.status === 'CAPTURING' && (
        <p className="dl-sandbox-artifacts__summary dl-network__summary">
          {t('netCapturing', { mac: network.mac ?? '?', time: fmtTime(network.startedAt) })}
        </p>
      )}
      {network.status === 'FAILED' && (
        <HpsmMessage kind="warning">{t('netFailed', { error: network.error ?? '?' })}</HpsmMessage>
      )}
      {network.status === 'STORED' && (
        <p className="dl-sandbox-artifacts__summary dl-network__summary">
          {t('netStored', {
            packets: network.packets ?? 0,
            size: fmtBytes(network.bytes),
            time: fmtTime(network.stoppedAt),
          })}
          {network.truncated && ` ${t('netTruncated')}`}{' '}
          {network.pcap && (
            <a href={`/api/sandbox/${sessionId}/pcap`} download>
              {t('netDownload')}
            </a>
          )}
        </p>
      )}
      {network.status === 'STORED' && network.error && (
        <p className="dl-hint-muted">{network.error}</p>
      )}
      {ids && (ids.status === 'PENDING' || ids.status === 'RUNNING') && (
        <p className="dl-hint-muted">{t('idsRunning')}</p>
      )}
      {ids?.status === 'FAILED' && (
        <HpsmMessage kind="warning">{t('idsFailed', { error: ids.error ?? '?' })}</HpsmMessage>
      )}
      {result && (
        <>
          <p className="dl-sandbox-artifacts__summary dl-network__summary">
            {t('idsSummary', { n: result.alertsTotal })}{' '}
            {result.rules?.count
              ? t('idsRules', { n: result.rules.count, date: fmtDate(result.rules.updatedAt) })
              : t('idsNoRules')}
          </p>
          <ArtifactTable
            label={t('idsAlerts')}
            head={[t('idsSeverity'), t('idsSignature'), t('idsFlow'), t('idsCount')]}
            rows={result.alerts.map((a) => [
              a.severity && SEVERITY[a.severity] ? t(SEVERITY[a.severity]) : '—',
              a.signature,
              `${a.proto ?? ''} ${a.src ?? '?'} → ${a.dst ?? '?'}`.trim(),
              String(a.count),
            ])}
          />
          <ArtifactTable
            label={t('idsDns')}
            head={[t('sysmonQuery'), t('idsType'), t('idsCount'), t('idsAnswers')]}
            rows={result.dns.map((d) => [
              d.name,
              d.type ?? '—',
              String(d.count),
              d.answers.join(', ') || '—',
            ])}
          />
          <ArtifactTable
            label={t('idsHttp')}
            head={[t('idsMethod'), t('idsStatus'), t('sysmonDestination'), t('idsUrl')]}
            rows={result.http.map((h) => [
              h.method ?? '—',
              h.status !== null && h.status !== undefined ? String(h.status) : '—',
              h.dst ?? '—',
              `${h.host ?? ''}${h.url ?? ''}`,
            ])}
          />
          <ArtifactTable
            label={t('idsTls')}
            head={[t('sysmonDestination'), t('idsIssuer'), t('idsSni')]}
            rows={result.tls.map((s) => [s.dst ?? '—', s.issuer ?? '—', s.sni ?? '—'])}
          />
        </>
      )}
      {network.status === 'STORED' && !ids && (network.packets ?? 0) > 0 && (
        <p className="dl-hint-muted">{t('idsOff')}</p>
      )}
      <p className="dl-hint-muted">{t('netNote')}</p>
    </div>
  );
}
