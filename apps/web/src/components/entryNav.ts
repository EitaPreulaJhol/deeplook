/**
 * Sequencia de amostras da ultima lista aberta (pagina atual da grade), usada
 * pelos botoes Anterior / Proxima da ficha da amostra. Fica na sessionStorage
 * para sobreviver ao F5 da ficha.
 */
const KEY = 'dl-entry-sequence';

export function saveEntrySequence(ids: string[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* sem armazenamento: a ficha so nao mostra Anterior/Proxima */
  }
}

export function loadEntrySequence(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
