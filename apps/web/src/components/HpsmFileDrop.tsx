import type { DragEvent } from 'react';
import { useId, useRef, useState } from 'react';

import { t } from '../i18n/submit';
import { IconPage } from './icons';

/** Tamanho legivel: 2483712 -> "2.4 MB". */
export function formatFileSize(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Mesmo nome e tamanho = o mesmo arquivo escolhido de novo. */
const fileKey = (f: File) => `${f.name}\u0000${f.size}`;

interface HpsmFileDropProps {
  files: File[];
  onChange: (files: File[]) => void;
  /** Varios arquivos: cada escolha soma a lista (sem repetir o mesmo arquivo). */
  multiple?: boolean;
  /** Limite da lista; o que passar e descartado e `onLimit` avisa. */
  maxFiles?: number;
  onLimit?: (max: number) => void;
  /** id do botao "Selecionar arquivo" (foco na validacao). */
  buttonId?: string;
  invalid?: boolean;
}

/**
 * Campo de arquivo no estilo HPSM: area "Arraste o arquivo aqui ou [Selecionar
 * arquivo]" e, depois da escolha, uma linha por arquivo com nome, tamanho e
 * "Remover". O input nativo fica oculto, mas e ele que o botao (e o teclado) aciona.
 */
export function HpsmFileDrop({
  files,
  onChange,
  multiple = false,
  maxFiles,
  onLimit,
  buttonId,
  invalid,
}: HpsmFileDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    if (!multiple) {
      onChange([picked[0]]);
      return;
    }
    const seen = new Set(files.map(fileKey));
    const next = [...files, ...picked.filter((f) => !seen.has(fileKey(f)))];
    const over = Boolean(maxFiles && next.length > maxFiles);
    onChange(over ? next.slice(0, maxFiles) : next);
    if (over && maxFiles) onLimit?.(maxFiles);
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files);
  };

  const remove = (file: File) => {
    onChange(files.filter((f) => f !== file));
    if (inputRef.current) inputRef.current.value = '';
  };

  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="hpsm-filedrop">
      <div
        className={`hpsm-filedrop__zone${dragging ? ' is-dragging' : ''}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span>
          {dragging
            ? multiple
              ? t('dropFiles')
              : t('dropFile')
            : multiple
              ? t('dragFiles')
              : t('dragFile')}
        </span>
        <button
          id={buttonId}
          type="button"
          className="dl-btn"
          aria-invalid={invalid || undefined}
          onClick={() => inputRef.current?.click()}
        >
          {multiple ? t('selectFiles') : t('selectFile')}
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          className="hpsm-filedrop__input"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {files.map((file) => (
        <div key={fileKey(file)} className="hpsm-filedrop__file">
          <IconPage size={16} />
          <span className="hpsm-filedrop__name" title={file.name}>
            {file.name}
          </span>
          <span className="hpsm-filedrop__size">({formatFileSize(file.size)})</span>
          <button
            type="button"
            className="hpsm-filedrop__remove"
            aria-label={t('removeFile', { name: file.name })}
            onClick={() => remove(file)}
          >
            {t('remove')}
          </button>
        </div>
      ))}
      {files.length > 1 && (
        <div className="hpsm-filedrop__total">
          {t('filesTotal', { n: files.length, size: formatFileSize(total) })}
          {maxFiles ? ` ${t('maxPerSubmission', { n: maxFiles })}` : ''}
        </div>
      )}
    </div>
  );
}
