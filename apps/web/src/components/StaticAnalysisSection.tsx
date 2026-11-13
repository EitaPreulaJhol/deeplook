import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { StaticInfo } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/analysis';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { HpsmMessage } from './messages';
import { PeAlerts, PeExtraBlocks, PeHeaderFields, SectionFlags } from './PeDetails';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

const ENTROPY: Record<StaticInfo['entropyLevel'], { tone: StatusTone; text: string }> = localized(
  () => ({
    low: { tone: 'none', text: t('entropyLow') },
    normal: { tone: 'none', text: t('entropyNormal') },
    high: { tone: 'orange', text: t('entropyHigh') },
  }),
);

const STRING_GROUPS: { key: keyof Omit<StaticInfo['strings'], 'total'>; label: string }[] =
  localized(() => [
    { key: 'suspicious', label: t('sgSuspicious') },
    { key: 'urls', label: 'URLs' },
    { key: 'ips', label: t('sgIps') },
    { key: 'emails', label: 'E-mails' },
    { key: 'paths', label: t('sgPaths') },
    { key: 'registry', label: t('sgRegistry') },
  ]);

/** Aviso no topo da ficha: executavel disfarcado com outra extensao. */
export function DisguisedFileWarning({ info }: { info?: StaticInfo | null }) {
  const mismatch = info?.extensionMismatch;
  if (!mismatch?.dangerous || !info?.detectedType) return null;
  return (
    <HpsmMessage kind="warning">
      {t('disguised1')} <strong>.{mismatch.declared}</strong>
      {t('disguised2')} <strong>{info.detectedType.label}</strong>
      {t('disguised3')}
    </HpsmMessage>
  );
}

/**
 * Secao "Analise estatica" da aba Detalhes: tipo real, entropia, cabecalho PE
 * (secoes, imports, funcoes suspeitas, empacotador), strings por categoria e
 * IOCs sugeridos (links para a ficha do indicador). Sem analise (amostras
 * antigas), analistas podem pedir agora.
 */
export function StaticAnalysisSection({
  entryId,
  info,
  canTriage,
  purged = false,
}: {
  entryId: string;
  info?: StaticInfo | null;
  canTriage: boolean;
  /** Arquivo expurgado pela retencao: nao ha o que (re)analisar. */
  purged?: boolean;
}) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.post(`/entries/${entryId}/static-analysis`, {});
      await queryClient.invalidateQueries({ queryKey: ['entry', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (!info) {
    return (
      <HpsmSection title={t('staticTitle')}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {purged ? t('staticPurged') : t('staticBefore')}{' '}
          {canTriage && !purged && (
            <button type="button" className="dl-link-button" disabled={running} onClick={analyze}>
              {running ? 'Analisando...' : t('analyzeNow')}
            </button>
          )}
        </p>
      </HpsmSection>
    );
  }

  const pe = info.pe;
  const elf = info.elf;
  const mismatch = info.extensionMismatch;
  const entropy = ENTROPY[info.entropyLevel];
  const suggested = info.iocCandidates;

  return (
    <HpsmSection title={t('staticTitle')}>
      <HpsmForm columns={2}>
        <HpsmField label={t('realType')}>
          <HpsmReadonly>
            {info.detectedType?.label ?? t('notIdentified')}
            {mismatch && (
              <>
                {' '}
                <StatusText tone={mismatch.dangerous ? 'red' : 'orange'}>
                  {mismatch.dangerous ? t('disguisedExe') : t('extMismatch')}: .{mismatch.declared}
                </StatusText>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('entropy')}>
          <HpsmReadonly>
            <StatusText tone={entropy.tone}>
              {t('entropyOf8', { value: info.entropy.toFixed(2), text: entropy.text })}
            </StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('analyzedAt')}>
          <HpsmReadonly>
            {fmtDate(info.analyzedAt)}
            {info.bytesAnalyzed < info.size &&
              ` ${t('firstBytes', { n: formatFileSize(info.bytesAnalyzed), total: formatFileSize(info.size) })}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('readableStrings')}>
          <HpsmReadonly>{info.strings.total}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>

      {pe && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">{t('peTitle')}</h4>
          {pe.imphash === undefined && (
            <p className="dl-static-empty">
              {t('peOld')}{' '}
              {canTriage && !purged && (
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={running}
                  onClick={analyze}
                >
                  {running ? 'Analisando...' : t('analyzeAgain')}
                </button>
              )}
            </p>
          )}
          <HpsmForm columns={2}>
            <PeAlerts alerts={pe.alerts} />
            <HpsmField label={t('architecture')}>
              <HpsmReadonly>{pe.machine}</HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('type')}>
              <HpsmReadonly>
                {pe.isDll ? t('dll') : t('exe')} · {pe.subsystem}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('compiledAt')} help={t('compiledHelp')}>
              <HpsmReadonly>{fmtDate(pe.compiledAt)}</HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('packer')}>
              <HpsmReadonly>
                {pe.packer ? (
                  <StatusText tone="orange">{pe.packer}</StatusText>
                ) : (
                  t('noneRecognized')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('suspiciousFns')} wide>
              <HpsmReadonly>
                {pe.suspiciousImports.length ? (
                  <span className="dl-static-chips">
                    {pe.suspiciousImports.map((fn) => (
                      <code key={fn}>{fn}</code>
                    ))}
                  </span>
                ) : (
                  t('noneWatchlist')
                )}
              </HpsmReadonly>
            </HpsmField>
            <PeHeaderFields pe={pe} />
          </HpsmForm>
          <div className="dl-static-tables">
            <TableContainer>
              <Table size="xs" aria-label={t('sectionsAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('section')}</TableHeader>
                    <TableHeader scope="col">{t('virtualSize')}</TableHeader>
                    <TableHeader scope="col">{t('rawSize')}</TableHeader>
                    <TableHeader scope="col">{t('entropy')}</TableHeader>
                    <TableHeader scope="col">{t('permissions')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pe.sections.map((s, i) => (
                    <TableRow key={`${s.name}-${i}`}>
                      <TableCell>
                        <code>{s.name || t('noName')}</code>
                      </TableCell>
                      <TableCell>{formatFileSize(s.virtualSize)}</TableCell>
                      <TableCell>{formatFileSize(s.rawSize)}</TableCell>
                      <TableCell>
                        {s.entropy >= 7.2 ? (
                          <StatusText tone="orange">{s.entropy.toFixed(2)}</StatusText>
                        ) : (
                          s.entropy.toFixed(2)
                        )}
                      </TableCell>
                      <TableCell>
                        <SectionFlags flags={s.flags} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TableContainer>
              <Table size="xs" aria-label={t('importedLibsAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('importedLib')}</TableHeader>
                    <TableHeader scope="col">{t('functions')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pe.imports.map((imp) => (
                    <TableRow key={imp.dll}>
                      <TableCell>
                        <code>{imp.dll}</code>
                      </TableCell>
                      <TableCell>{imp.functions}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          <PeExtraBlocks pe={pe} />
        </div>
      )}

      {elf && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">{t('elfTitle')}</h4>
          <HpsmForm columns={2}>
            {elf.alerts.length > 0 && (
              <HpsmField label={t('alerts')} wide top>
                <ul className="dl-doc-alerts">
                  {elf.alerts.map((alert) => (
                    <li key={alert}>
                      <StatusText tone="orange">{alert}</StatusText>
                    </li>
                  ))}
                </ul>
              </HpsmField>
            )}
            <HpsmField label={t('architecture')}>
              <HpsmReadonly>
                {elf.machine} · {elf.class} bits · {elf.endian === 'little' ? 'little' : 'big'}
                -endian
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('type')}>
              <HpsmReadonly>
                {elf.type}
                {elf.static ? ` · ${t('elfStatic')}` : ''}
                {elf.stripped ? ` · ${t('elfStripped')}` : ''}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('loader')} help={t('loaderHelp')}>
              <HpsmReadonly>{elf.interpreter ? <code>{elf.interpreter}</code> : '—'}</HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('packer')}>
              <HpsmReadonly>
                {elf.packer ? (
                  <StatusText tone="orange">{elf.packer}</StatusText>
                ) : (
                  t('noneRecognized')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('libraries')} wide>
              <HpsmReadonly>
                {elf.needed.length ? (
                  <span className="dl-static-chips">
                    {elf.needed.map((lib) => (
                      <code key={lib}>{lib}</code>
                    ))}
                  </span>
                ) : (
                  t('noneDeclared')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField
              label={t('suspiciousFns')}
              wide
              help={t('importedTotal', { n: elf.importedSymbols })}
            >
              <HpsmReadonly>
                {elf.suspiciousSymbols.length ? (
                  <span className="dl-static-chips">
                    {elf.suspiciousSymbols.map((fn) => (
                      <code key={fn}>{fn}</code>
                    ))}
                  </span>
                ) : (
                  t('noneWatchlist')
                )}
              </HpsmReadonly>
            </HpsmField>
          </HpsmForm>
          {elf.sections.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label={t('elfSectionsAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('section')}</TableHeader>
                    <TableHeader scope="col">{t('type')}</TableHeader>
                    <TableHeader scope="col">{t('size')}</TableHeader>
                    <TableHeader scope="col">{t('entropy')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {elf.sections.map((s, i) => (
                    <TableRow key={`${s.name}-${i}`}>
                      <TableCell>
                        <code>{s.name || t('noName')}</code>
                      </TableCell>
                      <TableCell>{s.type}</TableCell>
                      <TableCell>{formatFileSize(s.size)}</TableCell>
                      <TableCell>
                        {s.entropy >= 7.2 ? (
                          <StatusText tone="orange">{s.entropy.toFixed(2)}</StatusText>
                        ) : (
                          s.entropy.toFixed(2)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      <div className="dl-static-block">
        <h4 className="dl-static-title">{t('stringsByCategory')}</h4>
        {STRING_GROUPS.map(({ key, label }) => {
          const items = info.strings[key];
          return (
            <details
              key={key}
              className="dl-static-strings"
              open={key === 'suspicious' && items.length > 0}
            >
              <summary>
                {label} ({items.length})
              </summary>
              {items.length ? (
                <ul>
                  {items.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dl-static-empty">{t('noneDot')}</p>
              )}
            </details>
          );
        })}
      </div>

      {suggested.length > 0 && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">
            {t('suggestedIocs', { n: suggested.length })}{' '}
            <CopyButton
              value={suggested.map((i) => i.value).join('\n')}
              label={t('suggestedIocsLabel')}
            />
          </h4>
          <p className="dl-related-hint">{t('suggestedHelp')}</p>
          <ul className="dl-ioc-list">
            {suggested.map((ioc) => (
              <li key={`${ioc.kind}:${ioc.value}`}>
                <span className="dl-ioc-list__kind">{IOC_KIND_LABELS[ioc.kind]}</span>
                <Link className="dl-link dl-mono" to={iocHref(ioc.kind, ioc.value)}>
                  {ioc.value}
                </Link>
                <span className="dl-ioc-list__source">strings</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HpsmSection>
  );
}
