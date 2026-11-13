import { Fragment } from 'react';

import { localized } from '../i18n';
import { t } from '../i18n/shell';

export interface Shortcut {
  /** Alternativas; cada uma e uma combinacao de teclas (ex.: [['Ctrl', 'K']]). */
  keys: string[][];
  label: string;
  /** Aparece tambem nas Dicas da Pagina Inicial. */
  tip?: boolean;
}

/**
 * Lista unica dos atalhos de teclado: alimenta a caixa "Atalhos de teclado"
 * (? ou F1) e as Dicas da Pagina Inicial. Ao criar um atalho, registre-o aqui.
 */
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = localized(() => [
  {
    title: t('scGeneral'),
    items: [
      { keys: [['Ctrl', 'K']], label: t('scGoTo'), tip: true },
      { keys: [['Alt', 'N']], label: t('scSubmit'), tip: true },
      { keys: [['Alt', 'W']], label: t('scCloseTab'), tip: true },
      {
        keys: [['Ctrl', 'Shift', 'D']],
        label: t('scDecode'),
        tip: true,
      },
      { keys: [['?'], ['F1']], label: t('scHelp') },
    ],
  },
  {
    title: t('scLists'),
    items: [
      { keys: [['/']], label: t('scSearchList'), tip: true },
      { keys: [['↑'], ['↓'], ['Home'], ['End']], label: t('scMove') },
      { keys: [['Enter']], label: t('scOpen'), tip: true },
      { keys: [[t('keySpace')]], label: t('scToggle') },
    ],
  },
  {
    title: t('scForms'),
    items: [
      { keys: [['Ctrl', 'S']], label: t('scSave'), tip: true },
      { keys: [['Esc']], label: t('scEsc') },
    ],
  },
]);

/** Teclas no estilo HPSM: <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>F1</kbd>. */
export function ShortcutKeys({ keys }: { keys: string[][] }) {
  return (
    <span className="dl-keys">
      {keys.map((combo, i) => (
        <Fragment key={combo.join('+')}>
          {i > 0 && ' / '}
          {combo.map((key, j) => (
            <Fragment key={key}>
              {j > 0 && '+'}
              <kbd>{key}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
