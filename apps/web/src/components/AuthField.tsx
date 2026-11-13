import { useState } from 'react';

import { t } from '../i18n/shell';
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
  /** Campo destacado em vermelho (validacao). */
  invalid?: boolean;
}

/** Linha rotulo/campo da tela de login (rotulo a esquerda, campo em caixa, toggle de senha). */
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
  invalid,
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
    <div className={`dl-field${invalid ? ' dl-field--invalid' : ''}`}>
      <label className="dl-field__label" htmlFor={id}>
        {label}:{required && <span className="dl-field__req">*</span>}
      </label>
      <div className="dl-field__body">
        <div className="dl-field__control">
          <input
            id={id}
            className={inputClass}
            type={inputType}
            value={value}
            placeholder={placeholder}
            autoComplete={autoComplete}
            required={required}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {isPassword && (
            <button
              type="button"
              className="dl-field__toggle"
              aria-label={revealed ? t('hidePassword') : t('showPassword')}
              aria-pressed={revealed}
              onClick={() => setRevealed((previous) => !previous)}
            >
              {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          )}
        </div>
        {helperText && <span className="dl-field__help">{helperText}</span>}
      </div>
    </div>
  );
}
