import { Select, SelectItem, TextArea, TextInput } from '@carbon/react';
import { useEffect, useId, useRef, useState } from 'react';

import { CopyButton } from './CopyButton';
import type { Step, StepId } from './decoder';
import { DECODER_MAX, hexDump, resultText, runSteps, STEPS, suggestStep } from './decoder';

/** Caracteres do resultado mostrados (o resto fica no Copiar). */
const SHOWN = 200_000;

/**
 * Decodificador (item 85): cola o texto (ou abre com o que estava selecionado),
 * encadeia passos (Base64, hex, XOR, PowerShell -EncodedCommand, gzip…) e ve o
 * resultado em texto ou hex. Tudo no navegador; o resultado nunca vira HTML.
 */
export function DecoderDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState(initial);
  const [steps, setSteps] = useState<Step[]>([]);
  const [view, setView] = useState<'text' | 'hex'>('text');
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    error?: { index: number; message: string };
  }>({ bytes: new Uint8Array() });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Esc fecha (no documento: um botao pode perder o foco).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Recalcula a cada mudanca (os passos de descompactar sao assincronos).
  useEffect(() => {
    let alive = true;
    void runSteps(input, steps).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [input, steps]);

  const suggestion = result.error ? null : suggestStep(result.bytes);
  const text = resultText(result.bytes);
  const shown = view === 'text' ? text.slice(0, SHOWN) : hexDump(result.bytes);
  const add = (id: StepId) => setSteps((s) => [...s, { id }]);

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box dl-decoder"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          Decodificar
        </h2>
        <div className="dl-decoder__body">
          <TextArea
            id="decoder-input"
            ref={inputRef}
            labelText="Texto"
            rows={4}
            value={input}
            maxLength={DECODER_MAX}
            onChange={(e) => setInput(e.target.value)}
          />
          <ol className="dl-decoder__steps" aria-label="Passos">
            {steps.map((step, i) => (
              <li key={i} className={result.error?.index === i ? 'is-error' : undefined}>
                <span className="dl-decoder__n">{i + 1}.</span>
                <Select
                  id={`decoder-step-${i}`}
                  labelText={`Passo ${i + 1}`}
                  hideLabel
                  size="sm"
                  value={step.id}
                  onChange={(e) =>
                    setSteps((s) =>
                      s.map((x, j) => (j === i ? { id: e.target.value as StepId } : x)),
                    )
                  }
                >
                  {(Object.keys(STEPS) as StepId[]).map((id) => (
                    <SelectItem key={id} value={id} text={STEPS[id].label} />
                  ))}
                </Select>
                {STEPS[step.id].param && (
                  <TextInput
                    id={`decoder-param-${i}`}
                    labelText={STEPS[step.id].param!}
                    hideLabel
                    size="sm"
                    placeholder={STEPS[step.id].param}
                    value={step.param ?? ''}
                    onChange={(e) =>
                      setSteps((s) =>
                        s.map((x, j) => (j === i ? { ...x, param: e.target.value } : x)),
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  className="dl-link-button"
                  aria-label={`Tirar o passo ${i + 1}`}
                  onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}
                >
                  Tirar
                </button>
                {result.error?.index === i && (
                  <span className="dl-decoder__error" role="alert">
                    {result.error.message}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="dl-decoder__add">
            <Select
              id="decoder-add"
              labelText="Incluir passo"
              hideLabel
              size="sm"
              value=""
              onChange={(e) => e.target.value && add(e.target.value as StepId)}
            >
              <SelectItem value="" text="+ Incluir passo…" />
              {(Object.keys(STEPS) as StepId[]).map((id) => (
                <SelectItem key={id} value={id} text={STEPS[id].label} />
              ))}
            </Select>
            {suggestion && (
              <button type="button" className="dl-btn" onClick={() => add(suggestion)}>
                Sugestão: {STEPS[suggestion].label}
              </button>
            )}
          </div>
          <div className="dl-decoder__result">
            <div className="dl-decoder__bar">
              <span role="tablist" aria-label="Ver o resultado como">
                {(['text', 'hex'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    className={`dl-decoder__tab${view === v ? ' is-active' : ''}`}
                    onClick={() => setView(v)}
                  >
                    {v === 'text' ? 'Texto' : 'Hex'}
                  </button>
                ))}
              </span>
              <span className="dl-hint-muted">
                {result.bytes.length.toLocaleString('pt-BR')} byte(s)
                {view === 'hex' && result.bytes.length > 4096 && ' · hex dos primeiros 4 KB'}
              </span>
              <CopyButton value={text} label="resultado" />
            </div>
            <pre className="dl-decoder__out" aria-label="Resultado">
              {shown}
              {view === 'text' && text.length > SHOWN
                ? '\n… (cortado na tela; o Copiar leva tudo)'
                : ''}
            </pre>
          </div>
        </div>
        <div className="hpsm-modal__actions">
          <button type="button" className="dl-btn dl-btn--primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
