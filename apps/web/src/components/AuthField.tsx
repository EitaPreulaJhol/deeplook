import { useState } from 'react';

import { IconEye, IconEyeOff } from './icons';

type FieldType = 'text' | 'email' | 'password';

interface AuthFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: FieldType;
  placeholder?: string;
  autoComplete?: string;
  helperText?: string;
  required?: boolean;
  uppercase?: boolean;
}

/** Controle de formulario padronizado (label + input sublinhado + toggle de senha). */
export function AuthField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  helperText,
  required,
  uppercase,
}: AuthFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && revealed ? 'text' : type;

  const inputClass = [
    'dl-field__input',
    isPassword ? 'dl-field__input--with-toggle' : '',
    uppercase ? 'dl-field__input--upper' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="dl-field">
      <label className="dl-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="dl-field__control">
        <input
          id={id}
          className={inputClass}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            className="dl-field__toggle"
            aria-label={revealed ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={revealed}
            onClick={() => setRevealed((previous) => !previous)}
          >
            {revealed ? <IconEyeOff size={20} /> : <IconEye size={20} />}
          </button>
        )}
      </div>
      {helperText && <span className="dl-field__help">{helperText}</span>}
    </div>
  );
}
