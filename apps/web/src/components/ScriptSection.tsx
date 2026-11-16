import { useState } from 'react';

import type { ScriptInfo, StaticInfo } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import { useDecoder } from './shortcuts';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const LANGUAGE: Record<ScriptInfo['language'], string> = localized(() => ({
  powershell: 'PowerShell',
  javascript: 'JScript/JavaScript',
  vbscript: 'VBScript',
  batch: t('langBatch'),
  hta: t('langHta'),
}));

const RISK: Record<ScriptInfo['risk'], { label: string; tone: StatusTone }> = localized(() => ({
  high: { label: t('riskHigh'), tone: 'red' },
  medium: { label: t('riskMedium'), tone: 'orange' },
  low: { label: t('riskLow'), tone: 'green' },
}));

const KIND: Record<ScriptInfo['findings'][number]['kind'], { label: string; tone: StatusTone }> =
  localized(() => ({
    download: { label: t('kindDownload'), tone: 'red' },
    execute: { label: t('kindExecute'), tone: 'red' },
    evasion: { label: t('kindEvasion'), tone: 'red' },
    persistence: { label: t('kindPersistence'), tone: 'orange' },
    obfuscation: { label: t('kindObfuscation'), tone: 'orange' },
    other: { label: t('kindOther'), tone: 'gray' },
  }));

/** Onde o achado apareceu: no arquivo ou numa camada decodificada. */
const where = (layer: number) => (layer === 0 ? t('inFile') : t('inLayer', { n: layer }));

/** Aviso no topo da ficha: script que baixa e executa ou tenta escapar. */
export function ScriptWarning({ info }: { info?: StaticInfo | null }) {
  const script = info?.script;
  if (!script || script.risk !== 'high') return null;
  const first = script.findings.find((f) => f.kind !== 'obfuscation') ?? script.findings[0];
  return (
    <HpsmMessage kind="warning">
      {t('scriptWarn', {
        language: LANGUAGE[script.language],
        detail: first ? ` (${first.name}: ${first.why})` : '',
      })}
    </HpsmMessage>
  );
}

/**
 * Secao "Script" (item 83): chamadas suspeitas com o porque e as camadas de
 * ofuscacao decodificadas (so texto). Nada foi executado.
 */
export function ScriptSection({ info }: { info?: StaticInfo | null }) {
  const script = info?.script;
  const [open, setOpen] = useState<number | null>(null);
  const decode = useDecoder();
  if (!script) return null;
  return (
    <HpsmSection title={t('scriptTitle', { language: LANGUAGE[script.language] })}>
      <HpsmForm columns={2}>
        <HpsmField label={t('risk')}>
          <HpsmReadonly>
            <StatusText tone={RISK[script.risk].tone}>{RISK[script.risk].label}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('lines')}>
          <HpsmReadonly>
            {script.lines}
            {script.encoded &&
              ` · ${t(
                // Analises antigas so marcavam o Script Encoder; as novas trazem o texto como camada.
                script.layers[0]?.method === 'Script Encoder (.vbe/.jse)'
                  ? 'encodedScriptDecoded'
                  : 'encodedScript',
              )}`}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('findings')} wide top>
          {script.findings.length === 0 ? (
            <HpsmReadonly>{t('noSuspiciousCalls')}</HpsmReadonly>
          ) : (
            <ul className="dl-doc-alerts">
              {script.findings.map((f) => (
                <li key={f.name}>
                  <StatusText tone={KIND[f.kind].tone}>
                    <strong>{f.name}</strong>
                  </StatusText>{' '}
                  — {f.why}{' '}
                  <span className="dl-hint-muted">
                    ({KIND[f.kind].label}, {where(f.layer)})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </HpsmField>
        {script.urls.length > 0 && (
          <HpsmField label={`URLs (${script.urls.length})`} wide top help={t('urlsHelp')}>
            <HpsmReadonly
              multiline
              mono
              copyable={{ value: script.urls.join('\n'), label: 'URLs' }}
            >
              {script.urls.join('\n')}
            </HpsmReadonly>
          </HpsmField>
        )}
      </HpsmForm>
      {script.layers.length > 0 && (
        <div className="dl-doc-macros">
          <h3 className="dl-doc-macros__head">{t('decodedLayers', { n: script.layers.length })}</h3>
          <ul>
            {script.layers.map((l, i) => (
              <li key={i}>
                <div className="dl-doc-macros__row">
                  <span className="dl-mono">{t('layer', { n: i + 1 })}</span>
                  <span className="dl-doc-macros__meta">
                    {t('layerMeta', {
                      method: l.method,
                      where: where(l.from),
                      n: l.text.length.toLocaleString(intlLocale()),
                    })}
                  </span>
                  <button
                    type="button"
                    className="dl-link-button"
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {open === i ? t('hideText') : t('showText')}
                  </button>
                  <button type="button" className="dl-link-button" onClick={() => decode(l.text)}>
                    {t('decodeEllipsis')}
                  </button>
                </div>
                {open === i && (
                  <pre className="dl-doc-macros__code" aria-label={t('layerText', { n: i + 1 })}>
                    {l.text}
                    {l.truncated ? `\n… ${t('cut')}` : ''}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </HpsmSection>
  );
}
