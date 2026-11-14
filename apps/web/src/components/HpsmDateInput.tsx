import { TextInput } from '@carbon/react';
import { useEffect, useRef, useState } from 'react';

import { intlLocale, useLocale } from '../i18n';
import { t } from '../i18n/shell';
import { datePlaceholder, formatIsoDate, parseLocaleDate } from './dateField';
import { IconCalendar } from './icons';

interface HpsmDateInputProps {
  id: string;
  labelText: string;
  /** Data ISO (aaaa-mm-dd). */
  value: string;
  min?: string;
  max?: string;
  /** Chamado so com data valida e dentro de min/max, em ISO. */
  onChange: (iso: string) => void;
}

/**
 * Campo de data no formato do idioma do app (dd/mm/aaaa ou mm/dd/yyyy), e nao no do navegador como o
 * `type="date"` nativo (pendencias da varredura visual, item 1). O botao ao lado abre o calendario
 * do navegador, por um campo nativo escondido que so serve para escolher o dia.
 */
export function HpsmDateInput({ id, labelText, value, min, max, onChange }: HpsmDateInputProps) {
  const locale = intlLocale(useLocale());
  const [draft, setDraft] = useState(() => formatIsoDate(value, locale));
  const [editing, setEditing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [d, m, y] = t('dateLetters').split(' ');
  const pattern = datePlaceholder(locale, { day: d, month: m, year: y });

  // O valor de fora (periodo escolhido, URL, idioma) manda enquanto a pessoa nao esta digitando.
  useEffect(() => {
    if (!editing) setDraft(formatIsoDate(value, locale));
  }, [value, locale, editing]);

  const accept = (iso: string | null) =>
    iso !== null && (!min || iso >= min) && (!max || iso <= max) ? iso : null;
  const parsed = accept(parseLocaleDate(draft, locale));
  const invalid = editing && draft.trim() !== '' && parsed === null;

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // Navegador sem showPicker (ou sem gesto do usuario): fica o campo de texto.
      document.getElementById(id)?.focus();
    }
  };

  return (
    <span className="dl-date-input">
      <TextInput
        id={id}
        labelText={labelText}
        hideLabel
        size="sm"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder={pattern}
        value={draft}
        invalid={invalid}
        invalidText={t('dateInvalid', { pattern })}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          // Saiu com texto incompleto ou invalido: volta para a data em vigor.
          setEditing(false);
          setDraft(formatIsoDate(value, locale));
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const iso = accept(parseLocaleDate(e.target.value, locale));
          if (iso && iso !== value) onChange(iso);
        }}
      />
      <button
        type="button"
        className="dl-date-input__button"
        title={t('openCalendar')}
        aria-label={t('openCalendar')}
        onClick={openPicker}
      >
        <IconCalendar />
      </button>
      <input
        ref={picker}
        type="date"
        className="dl-date-input__picker"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const iso = accept(e.target.value || null);
          if (iso && iso !== value) onChange(iso);
        }}
      />
    </span>
  );
}
