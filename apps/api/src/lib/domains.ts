/**
 * Segundos niveis comuns sob TLDs de pais (com.br, gov.br, co.uk...): neles o
 * dominio registravel tem tres partes.
 */
const SECOND_LEVEL = new Set([
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'mil',
  'co',
  'ac',
  'nom',
  'art',
  'blog',
  'app',
  'ind',
  'inf',
  'adv',
  'eng',
  'med',
  'jus',
  'leg',
  'tec',
]);

/**
 * Dominio-base aproximado de um host (sem lista publica de sufixos):
 * login.banco.com.br -> banco.com.br, cdn.exemplo.com -> exemplo.com.
 * IPs e hosts de uma ou duas partes voltam como estao.
 */
export function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-take).join('.');
}
