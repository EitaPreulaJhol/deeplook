/**
 * Capacidades do capa que pesam na triagem (item 7.4), pelo prefixo do namespace. Grupos inteiros
 * como load-code tambem tem o que todo executavel faz (parse PE header), entao ali so os ramos de
 * risco. A tela usa a mesma lista para o destaque (apps/web/src/components/CapaSection.tsx).
 */
export const CAPA_RISKY = [
  'anti-analysis',
  'collection',
  'communication',
  'impact',
  'persistence',
  'exploitation',
  'malware-family',
  'load-code/shellcode',
  'load-code/dotnet',
  'host-interaction/process/inject',
];

export const capaRisky = (namespace: string) =>
  CAPA_RISKY.some((prefix) => namespace === prefix || namespace.startsWith(`${prefix}/`));
