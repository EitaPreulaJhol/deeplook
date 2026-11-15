declare module '@novnc/novnc' {
  /** Tipagem minima do RFB (noVNC 1.7) para o que usamos no console. */
  /** Imagem de cursor como o noVNC guarda (RGBA). */
  interface CursorImage {
    rgbaPixels: Uint8Array;
    w: number;
    h: number;
    hotx: number;
    hoty: number;
  }

  export default class RFB {
    /** Cursores prontos do noVNC: o vazio e o ponto do showDotCursor. */
    static cursors: { none: CursorImage; dot: CursorImage };

    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);

    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    addEventListener(type: string, listener: (event: CustomEvent) => void): void;
    removeEventListener(type: string, listener: (event: CustomEvent) => void): void;
    disconnect(): void;
    sendCtrlAltDel(): void;
    sendCredentials(credentials: { password?: string; username?: string; target?: string }): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;
    blur(): void;
  }
}
