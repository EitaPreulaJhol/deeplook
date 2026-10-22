import type { DragEvent } from 'react';
import { useId, useRef, useState } from 'react';

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

interface HpsmFileDropProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** id do botao "Selecionar arquivo" (foco na validacao). */
  buttonId?: string;
  invalid?: boolean;
}

/**
 * Campo de arquivo no estilo HPSM: area "Arraste o arquivo aqui ou [Selecionar
 * arquivo]" e, depois da escolha, a linha com nome, tamanho e "Remover". O input
 * nativo fica oculto, mas e ele que o botao (e o teclado) aciona.
 */
export function HpsmFileDrop({ file, onChange, buttonId, invalid }: HpsmFileDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    onChange(files && files.length > 0 ? files[0] : null);
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

  const clear = () => {
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="hpsm-filedrop">
      <div
        className={`hpsm-filedrop__zone${dragging ? ' is-dragging' : ''}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span>{dragging ? 'Solte o arquivo para anexar' : 'Arraste o arquivo aqui ou'}</span>
        <button
          id={buttonId}
          type="button"
          className="dl-btn"
          aria-invalid={invalid || undefined}
          onClick={() => inputRef.current?.click()}
        >
          Selecionar arquivo
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="hpsm-filedrop__input"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => pick(event.target.files)}
        />
      </div>

      {file && (
        <div className="hpsm-filedrop__file">
          <IconPage size={16} />
          <span className="hpsm-filedrop__name" title={file.name}>
            {file.name}
          </span>
          <span className="hpsm-filedrop__size">({formatFileSize(file.size)})</span>
          <button type="button" className="hpsm-filedrop__remove" onClick={clear}>
            Remover
          </button>
        </div>
      )}
    </div>
  );
}
