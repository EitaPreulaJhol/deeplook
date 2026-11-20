import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { GoInfo, UnpackInfo, WebPackage } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText, VerdictTag } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
/** Tipos do Detect It Easy em destaque: o que esconde ou embrulha o codigo. */
const DIE_RISKY = new Set(['packer', 'protector', 'cryptor', 'obfuscator', 'joiner']);

/** Desempacotamento da amostra; atualiza a cada 5 s enquanto esta na fila ou trabalhando. */
export function useUnpack(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['unpack', entryId],
    queryFn: () => api.get<UnpackInfo>(`/entries/${entryId}/unpack`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(job: NonNullable<UnpackInfo['job']>): { tone: StatusTone; text: string } {
  if (job.status === 'PENDING') return { tone: 'blue', text: t('queued') };
  if (job.status === 'RUNNING')
    return { tone: 'blue', text: t('unpackingSince', { date: fmtDate(job.startedAt) }) };
  if (job.status === 'FAILED')
    return { tone: 'orange', text: t('failed', { error: job.error ?? t('unknownErr') }) };
  const made = (job.files ?? []).filter((f) => f.entryId).length;
  if (!job.unpacker) {
    // Nota do porque (nada a desempacotar, protetor, empacotador sem desempacotador estatico).
    const protectedOrPacked = /^(protegido|empacotado)/.test(job.note ?? '');
    return {
      tone: protectedOrPacked ? 'orange' : 'none',
      text: job.note ? job.note[0].toUpperCase() + job.note.slice(1) : t('nothingToUnpack'),
    };
  }
  return {
    tone: made ? 'green' : 'none',
    text: t('extractedFiles', { n: made, date: fmtDate(job.finishedAt) }),
  };
}

/** ASAR, CRX ou XPI (item 20): o manifesto da extensao (permissoes, hosts, scripts) ou o app. */
function WebPackageBlock({ pkg }: { pkg: WebPackage }) {
  const risky = new Set(pkg.extension?.risky ?? []);
  const chips = (items: string[]) =>
    items.length ? (
      <span className="dl-static-chips">
        {items.map((x) => (
          <code key={x}>{risky.has(x) ? <StatusText tone="orange">{x}</StatusText> : x}</code>
        ))}
      </span>
    ) : (
      '—'
    );
  const ext = pkg.extension;
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">
        {t(pkg.kind === 'asar' ? 'pkgAsar' : pkg.kind === 'crx' ? 'pkgCrx' : 'pkgXpi')}
        {pkg.crxVersion ? ` (CRX${pkg.crxVersion})` : ''}
      </h4>
      <HpsmForm columns={2}>
        {pkg.app && (
          <>
            <HpsmField label={t('pkgApp')}>
              <HpsmReadonly>
                {pkg.app.name} {pkg.app.version}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('pkgMain')}>
              <HpsmReadonly>{pkg.app.main ? <code>{pkg.app.main}</code> : '—'}</HpsmReadonly>
            </HpsmField>
          </>
        )}
        {ext && (
          <>
            <HpsmField label={t('pkgExtension')}>
              <HpsmReadonly>
                {ext.name} {ext.version}
                {ext.manifestVersion ? ` · Manifest V${ext.manifestVersion}` : ''}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('pkgUpdate')}>
              <HpsmReadonly>
                {ext.updateUrl ? <code>{ext.updateUrl}</code> : '—'}
                {ext.geckoId && (
                  <>
                    {' · '}
                    <code>{ext.geckoId}</code>
                  </>
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('pkgPermissions')} wide help={t('pkgPermissionsHelp')}>
              <HpsmReadonly>{chips(ext.permissions)}</HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('pkgHosts')} wide>
              <HpsmReadonly>{chips(ext.hostPermissions)}</HpsmReadonly>
            </HpsmField>
            {ext.contentScripts.length > 0 && (
              <HpsmField label={t('pkgContentScripts')} wide>
                <ul className="dl-die-list">
                  {ext.contentScripts.map((cs, i) => (
                    <li key={i}>
                      {chips(cs.js)} → {chips(cs.matches)}
                    </li>
                  ))}
                </ul>
              </HpsmField>
            )}
            {ext.background.length > 0 && (
              <HpsmField label={t('pkgBackground')} wide>
                <HpsmReadonly>{chips(ext.background)}</HpsmReadonly>
              </HpsmField>
            )}
            {ext.externallyConnectable.length > 0 && (
              <HpsmField label={t('pkgExternal')} wide>
                <HpsmReadonly>{chips(ext.externallyConnectable)}</HpsmReadonly>
              </HpsmField>
            )}
          </>
        )}
      </HpsmForm>
    </div>
  );
}

/** O executavel Go pelo GoReSym (item 14): versao, modulo, dependencias, build e funcoes do autor. */
function GoBlock({ go }: { go: GoInfo }) {
  const chips = (items: string[]) => (
    <span className="dl-static-chips">
      {items.map((x) => (
        <code key={x}>{x}</code>
      ))}
    </span>
  );
  return (
    <div className="dl-static-block">
      <h4 className="dl-static-title">{t('goTitle')}</h4>
      <HpsmForm columns={2}>
        <HpsmField label={t('goVersion')}>
          <HpsmReadonly>
            {go.version}
            {go.os && go.arch && ` · ${go.os}/${go.arch}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('goModule')} help={t('goModuleHelp')}>
          <HpsmReadonly>
            {go.main ? (
              <>
                <code>{go.main.path}</code> {go.main.version}
              </>
            ) : (
              (go.path ?? '—')
            )}
          </HpsmReadonly>
        </HpsmField>
        {go.settings.length > 0 && (
          <HpsmField label={t('goSettings')} wide>
            <HpsmReadonly>{chips(go.settings.map((s) => `${s.key}=${s.value}`))}</HpsmReadonly>
          </HpsmField>
        )}
      </HpsmForm>
      {go.deps.length > 0 && (
        <details className="dl-static-strings">
          <summary>{t('goDeps', { n: go.deps.length })}</summary>
          {chips(go.deps.map((d) => `${d.path} ${d.version}`))}
        </details>
      )}
      {go.functionCount > 0 && (
        <details className="dl-static-strings">
          <summary>{t('goFunctions', { n: go.functionCount })}</summary>
          {chips(go.functions)}
        </details>
      )}
      {go.files.length > 0 && (
        <details className="dl-static-strings">
          <summary>{t('goFiles', { n: go.files.length })}</summary>
          {chips(go.files)}
        </details>
      )}
    </div>
  );
}

/**
 * Secao "Identificacao e desempacotamento" da aba Detalhes (itens 7.8 e 7.9): o que o Detect It
 * Easy reconheceu e o que saiu do executavel (UPX, instalador, PyInstaller, arquivo embutido), cada
 * arquivo como amostra filha. Roda sozinho na chegada de todo executavel; analistas pedem de novo.
 */
export function UnpackSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useUnpack(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.applicable && !info.job)) return null;
  const job = info.job;
  const files = job?.files ?? [];
  const extracted = files.some((f) => f.entryId);

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/unpack`, {});
      await queryClient.invalidateQueries({ queryKey: ['unpack', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = job?.status === 'PENDING' || job?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.applicable && !busy && !extracted ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? t('requesting') : job ? t('analyzeAgain') : t('identifyUnpack')}
      </button>
    ) : null;

  const title = t('unpackTitle');
  if (!job) {
    return (
      <HpsmSection title={title}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled ? t('unpackNotYet') : t('unpackOff')} {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(job);
  const titles = new Map(info.children.map((c) => [c.id, c]));
  const detections = job.detections ?? [];
  return (
    <HpsmSection title={title}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label={t('sigState')} help={t('unpackHelp')}>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('unpacker')}>
          <HpsmReadonly>
            {job.label ?? '—'}
            {job.unpacker && job.note && ` · ${job.note}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField
          label="Detect It Easy"
          wide
          top
          help={t('dieHelp', { version: job.dieVersion ? ` ${job.dieVersion}` : '' })}
        >
          {detections.length ? (
            <ul className="dl-die-list">
              {detections.map((d, i) => (
                <li key={`${d.string}-${i}`}>
                  {DIE_RISKY.has(d.type.toLowerCase()) ? (
                    <StatusText tone="orange">{d.string}</StatusText>
                  ) : (
                    d.string
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <HpsmReadonly>
              {job.dieError
                ? t('dieNotIdentified', { error: job.dieError })
                : job.status === 'DONE' || job.status === 'FAILED'
                  ? t('nothingRecognized')
                  : '—'}
            </HpsmReadonly>
          )}
        </HpsmField>
        {job.magika && (
          <HpsmField label="Magika" wide help={t('magikaHelp')}>
            <HpsmReadonly>
              {job.magika.description} (<code>{job.magika.label}</code>) ·{' '}
              {t('magikaScore', { n: Math.round(job.magika.score * 100) })}
              {job.magika.mismatch && (
                <>
                  {' · '}
                  <StatusText tone="orange">
                    {t(job.magika.mismatch.basis === 'type' ? 'magikaVsType' : 'magikaVsExt', {
                      expected: job.magika.mismatch.expected.join(', '),
                    })}
                  </StatusText>
                </>
              )}
            </HpsmReadonly>
          </HpsmField>
        )}
      </HpsmForm>
      {job.decoded && job.decoded.length > 0 && (
        <HpsmForm columns={2}>
          <HpsmField label={t('decodedTitle')} wide help={t('decodedHelp')}>
            <ul className="dl-die-list">
              {job.decoded.map((d) => (
                <li key={`${d.offset}-${d.text}`}>
                  <StatusText tone="orange">{d.text}</StatusText>{' '}
                  <code>
                    {d.method} @ 0x{d.offset.toString(16)}
                  </code>
                </li>
              ))}
            </ul>
          </HpsmField>
        </HpsmForm>
      )}
      {job.webPackage && <WebPackageBlock pkg={job.webPackage} />}
      {job.go && <GoBlock go={job.go} />}
      {files.length > 0 && (
        <ul className="dl-unpack-files">
          {files.map((f, i) => {
            const child = f.entryId ? titles.get(f.entryId) : undefined;
            return (
              <li key={`${f.name}-${i}`}>
                {child ? (
                  <>
                    <Link className="dl-link" to={`/entries/${child.id}`}>
                      {child.title}
                    </Link>{' '}
                    <VerdictTag verdict={child.verdict} />
                  </>
                ) : (
                  <code>{f.name}</code>
                )}
                <span className="dl-hint-muted">
                  {' '}
                  · {formatFileSize(f.size)}
                  {f.skipped && ` · ${t('leftOut', { reason: f.skipped })}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </HpsmSection>
  );
}
