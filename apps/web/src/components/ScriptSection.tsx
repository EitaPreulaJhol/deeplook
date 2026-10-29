import { useState } from 'react';

import type { ScriptInfo, StaticInfo } from '../api/types';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const LANGUAGE: Record<ScriptInfo['language'], string> = {
  powershell: 'PowerShell',
  javascript: 'JScript/JavaScript',
  vbscript: 'VBScript',
  batch: 'Lote (BAT/CMD)',
  hta: 'HTA (aplicativo HTML)',
};

const RISK: Record<ScriptInfo['risk'], { label: string; tone: StatusTone }> = {
  high: { label: 'Alto', tone: 'red' },
  medium: { label: 'Médio', tone: 'orange' },
  low: { label: 'Baixo', tone: 'green' },
};

const KIND: Record<ScriptInfo['findings'][number]['kind'], { label: string; tone: StatusTone }> = {
  download: { label: 'baixa', tone: 'red' },
  execute: { label: 'executa', tone: 'red' },
  evasion: { label: 'evasão', tone: 'red' },
  persistence: { label: 'persistência', tone: 'orange' },
  obfuscation: { label: 'ofuscação', tone: 'orange' },
  other: { label: 'outro', tone: 'gray' },
};

/** Onde o achado apareceu: no arquivo ou numa camada decodificada. */
const where = (layer: number) => (layer === 0 ? 'no arquivo' : `na camada ${layer}`);

/** Aviso no topo da ficha: script que baixa e executa ou tenta escapar. */
export function ScriptWarning({ info }: { info?: StaticInfo | null }) {
  const script = info?.script;
  if (!script || script.risk !== 'high') return null;
  const first = script.findings.find((f) => f.kind !== 'obfuscation') ?? script.findings[0];
  return (
    <HpsmMessage kind="warning">
      Atenção: script {LANGUAGE[script.language]} com comportamento malicioso
      {first ? ` (${first.name}: ${first.why})` : ''}. Não execute fora do ambiente isolado.
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
  if (!script) return null;
  return (
    <HpsmSection title={`Script (${LANGUAGE[script.language]})`} className="dl-mt-lg">
      <HpsmForm columns={2}>
        <HpsmField label="Risco">
          <HpsmReadonly>
            <StatusText tone={RISK[script.risk].tone}>{RISK[script.risk].label}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Linhas">
          <HpsmReadonly>
            {script.lines}
            {script.encoded && ' · codificado com o Script Encoder (#@~^), não decodificado'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Achados" wide top>
          {script.findings.length === 0 ? (
            <HpsmReadonly>Nenhuma chamada suspeita encontrada.</HpsmReadonly>
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
          <HpsmField
            label={`URLs (${script.urls.length})`}
            wide
            top
            help="Achadas no arquivo e nas camadas. Só como texto: não abra fora do sandbox."
          >
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
          <h3 className="dl-doc-macros__head">Camadas decodificadas ({script.layers.length})</h3>
          <ul>
            {script.layers.map((l, i) => (
              <li key={i}>
                <div className="dl-doc-macros__row">
                  <span className="dl-mono">Camada {i + 1}</span>
                  <span className="dl-doc-macros__meta">
                    {l.method} · {where(l.from)} · {l.text.length.toLocaleString('pt-BR')}{' '}
                    caractere(s)
                  </span>
                  <button
                    type="button"
                    className="dl-link-button"
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {open === i ? 'Ocultar texto' : 'Ver texto'}
                  </button>
                </div>
                {open === i && (
                  <pre className="dl-doc-macros__code" aria-label={`Texto da camada ${i + 1}`}>
                    {l.text}
                    {l.truncated ? '\n… (cortado)' : ''}
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
