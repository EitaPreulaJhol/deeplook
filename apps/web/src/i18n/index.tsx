/**
 * Ponto de entrada do idioma da interface (revisao de novembro, item 2.5): o nucleo (core.ts) e o
 * t() da moldura (frame.ts). As telas importam o t() da propria area (i18n/<area>.ts).
 */
export * from './core';
export { type MessageKey, t } from './frame';
