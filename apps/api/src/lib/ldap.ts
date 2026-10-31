import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

import { Client } from 'ldapts';

import { env } from '../env';

/**
 * Login pelo AD/LDAP (item 94), opcional: sem LDAP_URL nada muda. So com TLS
 * (ldaps:// ou StartTLS) e certificado verificado; a busca usa uma conta de
 * servico e o valor digitado vai escapado no filtro (RFC 4515).
 */

export interface LdapConfig {
  url: string;
  startTls: boolean;
  /** CA que assina o certificado do servidor (PEM); sem ela, as CAs do sistema. */
  caFile: string | null;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  /** `{login}` vira o que a pessoa digitou (escapado). */
  userFilter: string;
  nameAttr: string;
  mailAttr: string;
  analystGroup: string | null;
  adminGroup: string | null;
  timeoutMs: number;
}

const DEFAULT_FILTER =
  '(&(objectClass=user)(|(sAMAccountName={login})(userPrincipalName={login})(mail={login})))';

let override: Partial<LdapConfig> | null = null;
/** Para os testes: outra configuracao (null volta para o ambiente). */
export function configureLdap(config: Partial<LdapConfig> | null): void {
  override = config;
}

/** Configuracao do ambiente; null se o AD nao esta ligado (LDAP_URL vazio). */
export function ldapConfig(): LdapConfig | null {
  const base: LdapConfig | null = env.LDAP_URL
    ? {
        url: env.LDAP_URL,
        startTls: env.LDAP_STARTTLS === 'true',
        caFile: env.LDAP_TLS_CA || null,
        bindDn: env.LDAP_BIND_DN,
        bindPassword: env.LDAP_BIND_PASSWORD,
        baseDn: env.LDAP_BASE_DN,
        userFilter: env.LDAP_USER_FILTER || DEFAULT_FILTER,
        nameAttr: env.LDAP_ATTR_NAME,
        mailAttr: env.LDAP_ATTR_MAIL,
        analystGroup: env.LDAP_ANALYST_GROUP || null,
        adminGroup: env.LDAP_ADMIN_GROUP || null,
        timeoutMs: 5000,
      }
    : null;
  if (!override) return base;
  if (override.url === '') return null;
  return { ...(base ?? ({} as LdapConfig)), timeoutMs: 5000, ...override } as LdapConfig;
}

/** Problema de configuracao que impede o uso (null = ok). */
export function ldapConfigProblem(c: LdapConfig): string | null {
  if (!/^ldaps?:\/\//i.test(c.url)) return 'LDAP_URL deve começar com ldaps:// ou ldap://';
  if (/^ldap:\/\//i.test(c.url) && !c.startTls) {
    return 'sem TLS: use ldaps:// ou LDAP_STARTTLS=true';
  }
  if (!c.baseDn || !c.bindDn) return 'faltam LDAP_BASE_DN e LDAP_BIND_DN';
  if (!c.userFilter.includes('{login}')) return 'LDAP_USER_FILTER sem {login}';
  return null;
}

/** Escapa um valor para dentro de um filtro LDAP (RFC 4515). */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function tlsOptions(c: LdapConfig): ConnectionOptions {
  return {
    rejectUnauthorized: true,
    ...(c.caFile ? { ca: [readFileSync(c.caFile)] } : {}),
  };
}

/** Conecta (com StartTLS se for o caso) e faz o bind da conta de servico. */
async function serviceClient(c: LdapConfig): Promise<Client> {
  const ldaps = /^ldaps:\/\//i.test(c.url);
  const client = new Client({
    url: c.url,
    timeout: c.timeoutMs,
    connectTimeout: c.timeoutMs,
    ...(ldaps ? { tlsOptions: tlsOptions(c) } : {}),
  });
  try {
    if (!ldaps) await client.startTLS(tlsOptions(c));
    await client.bind(c.bindDn, c.bindPassword);
    return client;
  } catch (err) {
    await client.unbind().catch(() => undefined);
    throw err;
  }
}

const first = (v: unknown): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  if (x === undefined || x === null) return null;
  return Buffer.isBuffer(x) ? x.toString('utf8') : String(x);
};
const all = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) =>
    Buffer.isBuffer(x) ? x.toString('utf8') : String(x),
  );
const sameDn = (a: string, b: string) =>
  a.replace(/\s*,\s*/g, ',').toLowerCase() === b.replace(/\s*,\s*/g, ',').toLowerCase();

export type LdapAuth =
  | { ok: true; dn: string; email: string; name: string; role: 'USER' | 'ANALYST' | 'ADMIN' }
  | { ok: false; reason: string };

/**
 * Confere usuario e senha no AD. O motivo da falha e so para a auditoria; a
 * pessoa sempre ve a mesma mensagem.
 */
export async function ldapAuthenticate(login: string, password: string): Promise<LdapAuth> {
  const c = ldapConfig();
  if (!c) return { ok: false, reason: 'AD não configurado' };
  const problem = ldapConfigProblem(c);
  if (problem) return { ok: false, reason: `AD mal configurado: ${problem}` };
  // Bind com senha vazia vira bind anonimo e "da certo": nunca.
  if (!password || !login.trim()) return { ok: false, reason: 'senha vazia' };

  let client: Client | null = null;
  try {
    client = await serviceClient(c);
    const { searchEntries } = await client.search(c.baseDn, {
      scope: 'sub',
      filter: c.userFilter.replaceAll('{login}', escapeFilter(login.trim())),
      attributes: [c.nameAttr, c.mailAttr, 'memberOf'],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) {
      return {
        ok: false,
        reason: searchEntries.length ? 'mais de uma conta no AD' : 'usuário não encontrado no AD',
      };
    }
    const entry = searchEntries[0];
    try {
      await client.bind(entry.dn, password);
    } catch {
      return { ok: false, reason: 'senha incorreta no AD' };
    }
    const email = first(entry[c.mailAttr])?.trim().toLowerCase();
    if (!email || !email.includes('@')) return { ok: false, reason: 'conta do AD sem e-mail' };
    const groups = all(entry.memberOf);
    const role =
      c.adminGroup && groups.some((g) => sameDn(g, c.adminGroup!))
        ? 'ADMIN'
        : c.analystGroup && groups.some((g) => sameDn(g, c.analystGroup!))
          ? 'ANALYST'
          : 'USER';
    return { ok: true, dn: entry.dn, email, name: first(entry[c.nameAttr])?.trim() || email, role };
  } catch (err) {
    return { ok: false, reason: `AD indisponível: ${(err as Error).message}` };
  } finally {
    await client?.unbind().catch(() => undefined);
  }
}

/** userAccountControl do AD com o bit ACCOUNTDISABLE (2). */
export function adDisabled(value: unknown): boolean {
  const n = Number(first(value));
  return Number.isInteger(n) && (n & 2) === 2;
}

/**
 * Situacao das contas no AD, por DN (item 108): `gone` se nao existe mais ou esta
 * desativada. Lanca se o AD nao responde: quem chama nao decide nada nesse caso.
 */
export async function ldapAccountsGone(dns: string[]): Promise<Set<string>> {
  const c = ldapConfig();
  if (!c) throw new Error('AD não configurado');
  const problem = ldapConfigProblem(c);
  if (problem) throw new Error(problem);
  const client = await serviceClient(c);
  const gone = new Set<string>();
  try {
    for (const dn of dns) {
      try {
        const { searchEntries } = await client.search(dn, {
          scope: 'base',
          filter: '(objectClass=*)',
          attributes: ['userAccountControl'],
        });
        if (!searchEntries.length || adDisabled(searchEntries[0].userAccountControl)) gone.add(dn);
      } catch (err) {
        if ((err as Error).name !== 'NoSuchObjectError') throw err;
        gone.add(dn);
      }
    }
  } finally {
    await client.unbind().catch(() => undefined);
  }
  return gone;
}

/** Linha do Status do sistema: conecta e faz o bind da conta de servico. */
export async function ldapProbe(): Promise<{ url: string; detail: string | null }> {
  const c = ldapConfig();
  if (!c) throw new Error('desligado');
  const problem = ldapConfigProblem(c);
  if (problem) throw new Error(problem);
  const client = await serviceClient(c);
  await client.unbind().catch(() => undefined);
  return { url: c.url, detail: null };
}
