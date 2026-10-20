import type { ReactElement } from 'react';

/**
 * Icones da pasta `apps/web/public/icons` (origem: pasta `/icons` do projeto).
 * Sao SVGs coloridos 16x16 no lugar dos antigos icones do Carbon.
 */
export interface IconProps {
  /** Tamanho em pixels (padrao 16). */
  size?: number;
  className?: string;
}

/** Tipo dos componentes de icone, compativel com o `renderIcon` do Carbon. */
export type IconComponent = (props: IconProps) => ReactElement;

/** Renderiza um arquivo SVG de `public/icons`. */
function Icon({ src, size = 16, className }: IconProps & { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
      aria-hidden="true"
    />
  );
}

/** Cria um componente de icone para o arquivo informado. */
function createIcon(src: string): IconComponent {
  return (props) => <Icon {...props} src={src} />;
}

export const IconFolder = createIcon('/icons/folder.svg');
export const IconHistory = createIcon('/icons/history.svg');
export const IconSettings = createIcon('/icons/settings.svg');
export const IconMenu = createIcon('/icons/menu.svg');
export const IconAdd = createIcon('/icons/add.svg');
export const IconLogout = createIcon('/icons/logout.svg');
export const IconRefresh = createIcon('/icons/refresh.svg');
export const IconScreen = createIcon('/icons/screen.svg');
export const IconTrash = createIcon('/icons/trash.svg');
export const IconArrowLeft = createIcon('/icons/arrow-left.svg');
export const IconDownload = createIcon('/icons/download.svg');
export const IconFilter = createIcon('/icons/filter.svg');
export const IconEye = createIcon('/icons/eye.svg');
export const IconEyeOff = createIcon('/icons/eye-off.svg');
export const IconKey = createIcon('/icons/key.svg');
export const IconPage = createIcon('/icons/page.svg');
