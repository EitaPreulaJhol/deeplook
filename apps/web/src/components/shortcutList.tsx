import { Fragment } from 'react';

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
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Geral',
    items: [
      { keys: [['Ctrl', 'K']], label: 'Ir para uma amostra (ID, SHA-256 ou texto)', tip: true },
      { keys: [['Alt', 'N']], label: 'Enviar amostra', tip: true },
      { keys: [['Alt', 'W']], label: 'Fechar a aba atual', tip: true },
      { keys: [['?'], ['F1']], label: 'Mostrar esta lista de atalhos' },
    ],
  },
  {
    title: 'Listas',
    items: [
      { keys: [['/']], label: 'Buscar na lista', tip: true },
      { keys: [['↑'], ['↓'], ['Home'], ['End']], label: 'Mover entre as linhas' },
      { keys: [['Enter']], label: 'Abrir a amostra da linha', tip: true },
      { keys: [['Espaço']], label: 'Marcar/desmarcar a linha (listas com seleção)' },
    ],
  },
  {
    title: 'Formulários e caixas',
    items: [
      { keys: [['Ctrl', 'S']], label: 'Salvar o formulário aberto', tip: true },
      { keys: [['Esc']], label: 'Fechar caixa ou menu (equivale a "Não")' },
    ],
  },
];

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
