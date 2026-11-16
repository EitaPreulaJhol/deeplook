import { readFileSync } from 'node:fs';

/**
 * Segredos por arquivo (plano pos-revisao, item 5.1): cada segredo aceita `NOME_FILE` ao lado de
 * `NOME`, com o valor lido do arquivo (sem a quebra de linha do fim). E o formato dos Docker secrets
 * e de qualquer cofre que monte o segredo como arquivo: o valor nao aparece no `docker inspect` nem
 * no `docker compose config`.
 *
 * Com os dois definidos, vale o arquivo: o compose padrao sempre preenche `NOME` (com o padrao do
 * .env), entao quem passa `NOME_FILE` num compose.override quer o arquivo.
 *
 * Roda antes de qualquer leitura do ambiente: no env.ts (API), no prisma.config.ts (migracoes), no
 * seed e na restauracao. Os servicos (capture, capa, ghidra, unpack, oletools) fazem o mesmo com o
 * token deles.
 */
export const SECRET_NAMES = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'DATA_KEY',
  'DATA_KEY_PREVIOUS',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'ADMIN_PASSWORD',
  'LDAP_BIND_PASSWORD',
  'PROXMOX_PASSWORD',
  'MIKROTIK_PASSWORD',
  'BACKUP_SCHEDULE_PASSWORD',
  'RESTORE_PASSWORD',
  'CAPTURE_TOKEN',
  'CAPA_TOKEN',
  'GHIDRA_TOKEN',
  'UNPACK_TOKEN',
  'OLETOOLS_TOKEN',
  'EMULATE_TOKEN',
  'ANDROID_TOKEN',
  'EXTRACT_TOKEN',
  'LLM_API_KEY',
  'NETCAP_TOKEN',
  'SURICATA_TOKEN',
  'VT_API_KEY',
  'ABUSECH_AUTH_KEY',
  'ABUSEIPDB_API_KEY',
] as const;

export class SecretFileError extends Error {}

/** Le os `NOME_FILE` definidos e poe o valor em `NOME`. Devolve os nomes lidos. */
export function loadSecretFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  for (const name of SECRET_NAMES) {
    const path = env[`${name}_FILE`];
    if (!path) continue;
    let value: string;
    try {
      value = readFileSync(path, 'utf8');
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? 'erro de leitura';
      throw new SecretFileError(`${name}_FILE: não foi possível ler ${path} (${reason})`);
    }
    value = value.replace(/\r?\n$/, '');
    if (!value) throw new SecretFileError(`${name}_FILE: o arquivo ${path} está vazio`);
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
}
