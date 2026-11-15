import { Checkbox } from '@carbon/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { t } from '../i18n/sandbox';
import { type OpenResult, readAutoRun, saveAutoRun, useOpenSandbox } from './sandboxOpen';

/**
 * As opcoes de inicio do ambiente isolado, num dialogo aberto pelo botao "Abrir ambiente isolado"
 * da barra de ferramentas da amostra: a execucao automatica (lembrada no navegador) e o botao que
 * inicia. Dialogo nativo em modal: o navegador cuida do foco, do Esc e de devolver o foco ao botao
 * da barra. "Iniciar ambiente" abre a janela do console no mesmo clique (senao o navegador a
 * bloqueia); um erro da API aparece aqui dentro, com o dialogo aberto.
 */
export function SandboxLaunchDialog({
  entryId,
  sampleName,
  onClose,
  onStarted,
  openConsole = true,
}: {
  entryId: string;
  sampleName: string;
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
    const result = await opener.open(autoRun, openConsole);
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
