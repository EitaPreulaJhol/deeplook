import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';

import type { PeAlert, PeInfo } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/analysis';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

/**
 * Partes da analise de PE do item 7.1 na secao "Analise estatica": alertas, hashes que ligam
 * amostras (imphash, Rich header), assinatura, versao, manifesto, .NET, recursos, exports e as
 * funcoes importadas. Analise antiga (sem estes campos) mostra so o que ja mostrava.
 */

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());

const ALERT_TONE: Record<PeAlert['level'], StatusTone> = {
  high: 'red',
  medium: 'orange',
  info: 'none',
};

const VERSION_LABELS: Record<string, string> = localized(() => ({
  CompanyName: t('verCompany'),
  FileDescription: t('verDescription'),
  FileVersion: t('verFileVersion'),
  InternalName: t('verInternalName'),
  OriginalFilename: t('verOriginalName'),
  ProductName: t('verProduct'),
  ProductVersion: t('verProductVersion'),
  LegalCopyright: 'Copyright',
  Comments: t('verComments'),
}));

/** Idiomas dos recursos: o idioma de quem compilou e uma pista de origem. */
const LANGS: Record<number, string> = localized(() => ({
  0: t('langNeutral'),
  1033: t('langEnUs'),
  2057: t('langEnGb'),
  1046: t('langPtBr'),
  2070: t('langPtPt'),
  3082: t('langEs'),
  1036: t('langFr'),
  1031: t('langDe'),
  1040: t('langIt'),
  1049: t('langRu'),
  1058: t('langUk'),
  2052: t('langZhCn'),
  1028: t('langZhTw'),
  1041: t('langJa'),
  1042: t('langKo'),
  1065: t('langFa'),
  1025: t('langAr'),
  1055: t('langTr'),
}));

const EXECUTION_LEVELS: Record<string, { text: string; tone: StatusTone }> = localized(() => ({
  requireAdministrator: { text: t('execAdmin'), tone: 'orange' },
  highestAvailable: { text: t('execHighest'), tone: 'orange' },
  asInvoker: { text: t('execInvoker'), tone: 'none' },
}));

/** Conteudo embutido que chama atencao (executavel ou arquivo compactado). */
const RISKY_CONTENT = new Set(['pe', 'elf', 'macho', 'zip', '7z', 'rar', 'cab', 'script', 'jar']);

export function PeAlerts({ alerts }: { alerts?: PeAlert[] }) {
  if (!alerts?.length) return null;
  return (
    <HpsmField label={t('alerts')} wide top>
      <ul className="dl-doc-alerts">
        {alerts.map((a) => (
          <li key={a.text}>
            <StatusText tone={ALERT_TONE[a.level]}>{a.text}</StatusText>
          </li>
        ))}
      </ul>
    </HpsmField>
  );
}

/** Campos novos do cabecalho, no mesmo formulario do PE. */
export function PeHeaderFields({ pe }: { pe: PeInfo }) {
  if (pe.imphash === undefined) return null;
  const level = pe.manifest?.executionLevel ? EXECUTION_LEVELS[pe.manifest.executionLevel] : null;
  return (
    <>
      <HpsmField label="Imphash" help={t('imphashHelp')}>
        <HpsmReadonly>
          {pe.imphash ? (
            <>
              <code>{pe.imphash}</code> <CopyButton value={pe.imphash} label="imphash" />
            </>
          ) : (
            t('noImports')
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label="Rich header" help={t('richHelp')}>
        <HpsmReadonly>
          {pe.rich ? (
            <>
              <code>{pe.rich.hash}</code> <CopyButton value={pe.rich.hash} label="Rich hash" />{' '}
              {pe.rich.checksumValid ? (
                t('richTools', { n: pe.rich.entries.length })
              ) : (
                <StatusText tone="orange">{t('edited')}</StatusText>
              )}
            </>
          ) : (
            t('richAbsent')
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('entryPoint')}>
        <HpsmReadonly>
          {pe.entryPoint ? (
            <>
              <code>0x{pe.entryPoint.rva.toString(16)}</code> {t('inSection')}{' '}
              <code>{pe.entryPoint.section ?? t('noneParen')}</code>
            </>
          ) : (
            '—'
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label="Checksum" help={t('checksumHelp')}>
        <HpsmReadonly>
          {!pe.checksum?.declared
            ? t('notFilled')
            : pe.checksum.computed === null
              ? t('notRecomputed')
              : pe.checksum.computed === pe.checksum.declared
                ? t('matches')
                : t('noMatch')}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('overlay')} help={t('overlayHelp')}>
        <HpsmReadonly>
          {pe.overlay
            ? t('overlayInfo', {
                size: formatFileSize(pe.overlay.size),
                type: pe.overlay.type ?? t('unknownType'),
                entropy: pe.overlay.entropy.toFixed(2),
              })
            : t('noneM')}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label="TLS callbacks" help={t('tlsHelp')}>
        <HpsmReadonly>{pe.tlsCallbacks ?? 0}</HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('manifest')}>
        <HpsmReadonly>
          {pe.manifest ? (
            level ? (
              <StatusText tone={level.tone}>{level.text}</StatusText>
            ) : (
              t('noExecLevel')
            )
          ) : (
            t('noneM')
          )}
        </HpsmReadonly>
      </HpsmField>
    </>
  );
}

function SignatureBlock({ signature }: { signature: NonNullable<PeInfo['signature']> }) {
  const situation: { tone: StatusTone; text: string } = signature.error
    ? { tone: 'orange', text: t('sigNotChecked', { error: signature.error }) }
    : signature.digestMatches === false
      ? { tone: 'red', text: t('sigAltered') }
      : !signature.signatureValid
        ? { tone: 'red', text: t('sigInvalid') }
        : { tone: 'green', text: t('sigIntact') };
  const signer = signature.signer;
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">{t('digitalSignature')}</h4>
      <HpsmForm columns={2}>
        <HpsmField label={t('sigState')} help={t('sigStateHelp')}>
          <HpsmReadonly>
            <StatusText tone={situation.tone}>{situation.text}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('signedBy')}>
          <HpsmReadonly>
            {signer?.subject ?? '—'}
            {signature.selfSigned && (
              <>
                {' '}
                <StatusText tone="orange">{t('selfSigned')}</StatusText>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('issuedBy')}>
          <HpsmReadonly>{signer?.issuer ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('certValidity')}>
          <HpsmReadonly>
            {signer ? `${fmtDay(signer.validFrom)} a ${fmtDay(signer.validTo)}` : '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('thumbprint')}>
          <HpsmReadonly>
            {signer ? (
              <>
                <code>{signer.sha1}</code>{' '}
                <CopyButton value={signer.sha1} label={t('thumbprintLower')} />
              </>
            ) : (
              '—'
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('timestamp')} help={t('timestampHelp')}>
          <HpsmReadonly>
            {signature.timestamp ? fmtDate(signature.timestamp) : t('noTimestamp')}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('declaredProgram')}>
          <HpsmReadonly>
            {[signature.programName, signature.programUrl].filter(Boolean).join(' · ') || '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('chainInFile')}>
          <HpsmReadonly>
            {signature.chain.length ? signature.chain.map((c) => c.subject).join(' → ') : '—'}
            {signature.nested > 0 && ` ${t('nested', { n: signature.nested })}`}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
    </div>
  );
}

function DotnetBlock({ dotnet }: { dotnet: NonNullable<PeInfo['dotnet']> }) {
  const chips = (items: string[], empty: string) =>
    items.length ? (
      <span className="dl-static-chips">
        {items.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </span>
    ) : (
      empty
    );
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">.NET</h4>
      <HpsmForm columns={2}>
        <HpsmField label="Assembly">
          <HpsmReadonly>
            {dotnet.assembly ? `${dotnet.assembly.name} ${dotnet.assembly.version}` : '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Runtime">
          <HpsmReadonly>
            {dotnet.runtime ?? '—'}
            {dotnet.flags.length > 0 && ` · ${dotnet.flags.join(', ')}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('typesMethods')}>
          <HpsmReadonly>
            {t('typesMethodsCount', { types: dotnet.types, methods: dotnet.methods })}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('obfuscator')}>
          <HpsmReadonly>
            {dotnet.obfuscator ? (
              <StatusText tone="orange">{dotnet.obfuscator}</StatusText>
            ) : (
              t('noneRecognized')
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('sensitiveCalls')} wide>
          <HpsmReadonly>{chips(dotnet.suspicious, t('noneWatchlist'))}</HpsmReadonly>
        </HpsmField>
        <HpsmField label="P/Invoke" wide help={t('pinvokeHelp')}>
          <HpsmReadonly>
            {chips(
              dotnet.pinvoke.map((f) => `${f.dll}!${f.name}`),
              t('noneF'),
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('references')} wide>
          <HpsmReadonly>{chips(dotnet.assemblyRefs, t('noneF'))}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>
    </div>
  );
}

/** Blocos abaixo das tabelas de secoes e imports. */
export function PeExtraBlocks({ pe }: { pe: PeInfo }) {
  if (pe.imphash === undefined) return null;
  const resources = pe.resources ?? [];
  const version = pe.version ? Object.entries(pe.version) : [];
  const named = pe.imports.filter((i) => i.names?.length);
  return (
    <>
      {pe.signature ? (
        <SignatureBlock signature={pe.signature} />
      ) : (
        <div className="dl-static-block">
          <h4 className="dl-static-title">{t('digitalSignature')}</h4>
          <p className="dl-static-empty">{t('noSignature')}</p>
        </div>
      )}
      {pe.dotnet && <DotnetBlock dotnet={pe.dotnet} />}
      {(version.length > 0 || resources.length > 0) && (
        <div className="dl-static-tables">
          {version.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label={t('versionInfoAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('versionInfo')}</TableHeader>
                    <TableHeader scope="col">{t('value')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {version.map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell>{VERSION_LABELS[key] ?? key}</TableCell>
                      <TableCell>{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {resources.length > 0 && (
            <TableContainer>
              <Table size="xs" aria-label={t('resourcesAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('resource')}</TableHeader>
                    <TableHeader scope="col">{t('language')}</TableHeader>
                    <TableHeader scope="col">{t('size')}</TableHeader>
                    <TableHeader scope="col">{t('entropy')}</TableHeader>
                    <TableHeader scope="col">{t('content')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {resources.map((r, i) => (
                    <TableRow key={`${r.type}-${r.name}-${r.lang}-${i}`}>
                      <TableCell>
                        <code>
                          {r.type}/{r.name}
                        </code>
                      </TableCell>
                      <TableCell>{LANGS[r.lang] ?? r.lang}</TableCell>
                      <TableCell>{formatFileSize(r.size)}</TableCell>
                      <TableCell>{r.entropy.toFixed(2)}</TableCell>
                      <TableCell>
                        {r.content ? (
                          RISKY_CONTENT.has(r.content) ? (
                            <StatusText tone="orange">{r.content}</StatusText>
                          ) : (
                            r.content
                          )
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pe.resourcesTruncated && <p className="dl-static-empty">{t('resourcesCut')}</p>}
            </TableContainer>
          )}
        </div>
      )}
      {pe.exports && (
        <details className="dl-static-strings">
          <summary>
            Exports ({pe.exports.total}){pe.exports.dll ? ` · ${pe.exports.dll}` : ''}
          </summary>
          <TableContainer>
            <Table size="xs" aria-label={t('exportedAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Ordinal</TableHeader>
                  <TableHeader scope="col">{t('name')}</TableHeader>
                  <TableHeader scope="col">{t('forwardsTo')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {pe.exports.symbols.map((s) => (
                  <TableRow key={s.ordinal}>
                    <TableCell>{s.ordinal}</TableCell>
                    <TableCell>{s.name ? <code>{s.name}</code> : t('ordinalOnly')}</TableCell>
                    <TableCell>{s.forwarder ? <code>{s.forwarder}</code> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {pe.exports.truncated && <p className="dl-static-empty">{t('listCut')}</p>}
        </details>
      )}
      {named.length > 0 && (
        <details className="dl-static-strings">
          <summary>
            {t('importedFns', { n: pe.imports.reduce((n, i) => n + i.functions, 0) })}
          </summary>
          {named.map((imp) => (
            <div key={imp.dll} className="dl-static-imports">
              <strong>{imp.dll}</strong>
              <span className="dl-static-chips">
                {imp.names!.map((fn, i) => (
                  <code key={`${fn}-${i}`}>{fn}</code>
                ))}
              </span>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/** Permissoes da secao: gravavel e executavel ao mesmo tempo em destaque. */
export function SectionFlags({ flags }: { flags?: string }) {
  if (!flags) return <>—</>;
  return flags.includes('W') && flags.includes('X') ? (
    <StatusText tone="red">{flags}</StatusText>
  ) : (
    <code>{flags}</code>
  );
}
