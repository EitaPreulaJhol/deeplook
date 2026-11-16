import { Checkbox, Select, SelectItem } from '@carbon/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { t } from '../i18n/sandbox';
import {
  durationChoices,
  formatMinutes,
  type OpenResult,
  readAutoRun,
  saveAutoRun,
  useOpenSandbox,
} from './sandboxOpen';

/**
 * As opcoes de inicio do ambiente isolado, num dialogo aberto pelo botao "Abrir ambiente isolado"
 * da barra de ferramentas da amostra: a execucao automatica (lembrada no navegador) e o botao que
 * inicia. Dialogo nativo em modal: o navegador cuida do foco, do Esc e de devolver o foco ao botao
 * da barra. "Iniciar ambiente" abre a janela do console no mesmo clique (senao o navegador a
 * bloqueia); um erro da API aparece aqui dentro, com o dialogo aberto. Com o teto da duracao e a
 * captura de rede configurada (GET /api/entries/:id/sandbox), tambem a duracao e ligar ou nao a
 * captura (plans/ajustes-usabilidade, item 5).
 */
export function SandboxLaunchDialog({
  entryId,
  sampleName,
  onClose,
  onStarted,
  openConsole = true,
  ttlMinutes,
  captureEnabled = false,
  memoryDumpEnabled = false,
}: {
  entryId: string;
  sampleName: string;
  /** Teto da duracao (SANDBOX_TTL_MINUTES); sem ele, nao ha escolha de duracao. */
  ttlMinutes?: number;
  /** Captura de rede configurada: a caixa para desliga-la neste ambiente. */
  captureEnabled?: boolean;
  /** O dump de memoria esta ligado no servidor (plans/novas-analises, item 3). */
  memoryDumpEnabled?: boolean;
  /** Abre a janela do console ao iniciar (false dentro da propria janela do console). */
  openConsole?: boolean;
  onClose: () => void;
  /** O ambiente foi pedido (com o aviso, se o navegador bloqueou a janela do console). */
  onStarted: (result: OpenResult) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const [autoRun, setAutoRun] = useState(readAutoRun);
  const [minutes, setMinutes] = useState<number | undefined>(ttlMinutes);
  const [capture, setCapture] = useState(true);
  const [memoryDump, setMemoryDump] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const opener = useOpenSandbox(entryId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // O foco inicial na acao principal: o autoFocus do React foca na montagem, antes do
    // showModal, e o navegador entao focaria o primeiro campo (a caixa).
    startRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    // "Cancelar" e um botao do form com method=dialog: deixa o navegador fechar.
    if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'cancel') return;
    e.preventDefault();
    setError(null);
    const result = await opener.open(
      {
        autoRun,
        minutes,
        capture: captureEnabled ? capture : undefined,
        memoryDump: memoryDumpEnabled && autoRun ? memoryDump : undefined,
      },
      openConsole,
    );
    if (result.kind === 'error') {
      setError(result.text);
      return;
    }
    onStarted(result);
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="hpsm-modal__box dl-launch-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId} className="hpsm-modal__head">
        {t('openEnv')}
      </h2>
      <form method="dialog" onSubmit={(e) => void submit(e)}>
        <div className="dl-launch-dialog__body">
          <p>{t('intro')}</p>
          <p>
            <strong>{t('launchSample')}</strong> <code className="dl-mono">{sampleName}</code>
          </p>
          <fieldset className="dl-launch-dialog__options">
            <legend>{t('launchOptions')}</legend>
            <Checkbox
              id={`sandbox-autorun-${entryId}`}
              labelText={t('autoRunLabel')}
              helperText={t('autoRunHelp')}
              checked={autoRun}
              disabled={opener.busy}
              onChange={(_, { checked }) => {
                setAutoRun(checked);
                saveAutoRun(checked);
              }}
            />
            {memoryDumpEnabled && (
              <Checkbox
                id={`sandbox-memdump-${entryId}`}
                labelText={t('memoryDumpLabel')}
                helperText={t('memoryDumpHelp')}
                checked={autoRun && memoryDump}
                disabled={opener.busy || !autoRun}
                onChange={(_, { checked }) => setMemoryDump(checked)}
              />
            )}
            {captureEnabled && (
              <Checkbox
                id={`sandbox-capture-${entryId}`}
                labelText={t('captureLabel')}
                helperText={t('captureHelp')}
                checked={capture}
                disabled={opener.busy}
                onChange={(_, { checked }) => setCapture(checked)}
              />
            )}
            {ttlMinutes !== undefined && (
              <Select
                id={`sandbox-minutes-${entryId}`}
                className="dl-launch-dialog__duration"
                labelText={t('durationLabel')}
                helperText={t('durationHelp')}
                size="sm"
                value={String(minutes ?? ttlMinutes)}
                disabled={opener.busy}
                onChange={(e) => setMinutes(Number(e.target.value))}
              >
                {durationChoices(ttlMinutes).map((m) => (
                  <SelectItem key={m} value={String(m)} text={formatMinutes(m)} />
                ))}
              </Select>
            )}
          </fieldset>
          {error && (
            <p className="dl-launch-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="hpsm-modal__actions">
          <button type="submit" value="cancel" className="dl-btn" formNoValidate>
            {t('cancel')}
          </button>
          <button
            type="submit"
            value="start"
            className="dl-btn dl-btn--primary"
            disabled={opener.busy}
            ref={startRef}
          >
            {opener.busy ? t('opening') : t('launchStart')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
