import type { KeyboardEvent } from 'react';
import { Fragment, useEffect, useId, useRef } from 'react';

import { t } from '../i18n/shell';
import { SHORTCUT_GROUPS, ShortcutKeys } from './shortcutList';

/**
 * Caixa "Atalhos de teclado" (? ou F1), no mesmo desenho do HpsmConfirm.
 * Esc ou [Fechar] fecham; o foco volta para onde estava.
 */
export function HpsmShortcutsHelp({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Esc fecha; Tab fica no unico botao (modal).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeRef.current?.focus();
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box hpsm-modal__box--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {t('shortcutsTitle')}
        </h2>
        <div className="dl-shortcuts">
          <table className="dl-shortcuts__table">
            <tbody>
              {SHORTCUT_GROUPS.map((group) => (
                <Fragment key={group.title}>
                  <tr className="dl-shortcuts__group">
                    <th colSpan={2} scope="colgroup">
                      {group.title}
                    </th>
                  </tr>
                  {group.items.map((item) => (
                    <tr key={item.label}>
                      <th scope="row">
                        <ShortcutKeys keys={item.keys} />
                      </th>
                      <td>{item.label}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hpsm-modal__actions">
          <button ref={closeRef} type="button" className="dl-btn dl-btn--primary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
