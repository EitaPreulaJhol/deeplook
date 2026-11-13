import net from 'node:net';

import { z } from 'zod';

import { loadSecretFiles } from './secret-files';

/** Faixa CIDR (ou um endereco so), IPv4 ou IPv6. */
function isCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  const family = net.isIP(address);
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 6 ? 128 : 32);
}

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('production'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET deve ter ao menos 16 caracteres'),
    /**
     * Chave de dados (lib/data-key.ts): cifra o segredo do 2FA no banco. Vazia, a chave sai do
     * SESSION_SECRET (antigo), e troca-lo quebra o 2FA de todos. DATA_KEY_PREVIOUS so existe
     * durante a troca do proprio DATA_KEY: a chave antiga, para a subida recifrar com a nova.
     */
    DATA_KEY: z
      .string()
      .refine((v) => v === '' || v.length >= 32, 'use 32 caracteres ou mais (openssl rand -hex 32)')
      .default(''),
    DATA_KEY_PREVIOUS: z.string().default(''),
    SESSION_TTL_HOURS: z.coerce.number().default(168),
    /** Expiracao por inatividade (min); o TTL acima vira o teto absoluto. */
    SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(1440).default(30),
    /** Prazo das amostras nao concluidas (horas no status atual): alerta e atraso. */
    SLA_WARN_HOURS: z.coerce.number().min(1).default(24),
    SLA_LATE_HOURS: z.coerce.number().min(1).default(72),
    /** Prazos das outras prioridades ("alerta/atraso" em horas); o P3 usa os dois acima. */
    SLA_P1_HOURS: z
      .string()
      .regex(/^\d+\/\d+$/, 'use "alerta/atraso", ex.: 2/4')
      .default('2/4'),
    SLA_P2_HOURS: z
      .string()
      .regex(/^\d+\/\d+$/, 'use "alerta/atraso", ex.: 8/24')
      .default('8/24'),
    SLA_P4_HOURS: z
      .string()
      .regex(/^\d+\/\d+$/, 'use "alerta/atraso", ex.: 72/120')
      .default('72/120'),
    /** Escalonamento (item 73): ao atrasar, sobe a prioridade um nivel (P4 -> P3...). */
    SLA_ESCALATE_PRIORITY: z.enum(['true', 'false']).default('false'),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    /**
     * Rede de onde a API aceita conexao e o X-Forwarded-For (src/lib/network.ts): a
     * sub-rede fixa da rede `deeplook` do compose. Vazio = qualquer rede privada (antigo).
     */
    TRUSTED_NETWORK: z
      .string()
      .default('')
      .refine(
        (v) =>
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .every(isCidr),
        'use faixas CIDR separadas por virgula, ex.: 172.31.250.0/24',
      ),
    /** Demonstracao local: sobe mesmo com segredos padrao (nunca em producao de verdade). */
    ALLOW_INSECURE_DEFAULTS: z.enum(['true', 'false']).default('false'),
    ADMIN_EMAIL: z.string().email().default('admin@deeplook.local'),
    ADMIN_PASSWORD: z.string().min(6).default('admin12345'),
    ADMIN_NAME: z.string().default('Administrator'),
    MAX_UPLOAD_MB: z.coerce.number().default(200),
    /** Envios ao mesmo tempo somam ate isto em memoria; acima, 503 (item 117). */
    MAX_UPLOAD_MEMORY_MB: z.coerce.number().int().min(1).default(600),
    /**
     * Envios chegando ao mesmo tempo somam ate isto em disco, no /tmp da API (revisao de
     * novembro, 2.3); acima, 503. O corpo so vai para a memoria depois de chegar inteiro.
     */
    MAX_UPLOAD_SPOOL_MB: z.coerce.number().int().min(1).default(2048),
    /** Envios por usuario comum nas ultimas 24 h (item 64); 0 desliga. */
    UPLOAD_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
    S3_ENDPOINT: z.string().default('http://minio:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().default('deeplook'),
    S3_SECRET_KEY: z.string().default('deeplook123'),
    S3_BUCKET: z.string().default('deeplook-samples'),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),

    // ---- Sandbox (VM isolada no Proxmox VE) ----
    SANDBOX_ENABLED: z.enum(['true', 'false']).default('false'),
    /**
     * Retencao: apaga o arquivo das amostras concluidas ha mais de N dias
     * (ficha, relatorios, IOCs e hash ficam). 0 = desligada.
     */
    RETENTION_DAYS: z.coerce.number().int().min(0).max(36500).default(0),
    /** Backup em ZIP (item 81): dias ate o ZIP expirar e o comando do pg_dump (16+). */
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    BACKUP_PG_DUMP: z.string().min(1).default('pg_dump'),
    /**
     * Pasta dos ZIPs (item 6.13), vista de dentro do container (o compose monta ali o
     * BACKUP_DIR do .env). Vazia, o ZIP vai para o bucket, no mesmo disco dos dados.
     */
    BACKUP_DIR: z.string().default(''),
    /** Log centralizado de alertas (plano pos-revisao, item 5.2): caminho do arquivo; vazio desliga. */
    ALERT_LOG: z.string().default(''),
    /**
     * Senha do ZIP do backup agendado (item 6.13): a da tela nao fica guardada, entao o
     * agendamento usa esta. Vazia, o agendamento nao liga. O ZIP agendado leva as amostras.
     */
    BACKUP_SCHEDULE_PASSWORD: z
      .string()
      .refine((v) => v === '' || v.length >= 12, 'use 12 caracteres ou mais')
      .default(''),
    /**
     * Conferencia de integridade (item 4.2): de tempos em tempos o job le as amostras guardadas
     * e compara o SHA-256 com o da ficha, comecando pelas nunca conferidas. Intervalo em
     * minutos (0 = desligado) e quanto ler por rodada, em MB.
     */
    INTEGRITY_SCRUB_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10080).default(60),
    INTEGRITY_SCRUB_MAX_MB: z.coerce.number().int().min(1).max(102400).default(512),
    /**
     * Login pelo AD/LDAP (item 94), opcional: vazio = desligado. So com TLS
     * (ldaps:// ou ldap:// + LDAP_STARTTLS=true) e certificado verificado
     * (LDAP_TLS_CA = PEM da CA, se nao for uma CA do sistema).
     */
    LDAP_URL: z.string().default(''),
    LDAP_STARTTLS: z.enum(['true', 'false']).default('false'),
    LDAP_TLS_CA: z.string().default(''),
    LDAP_BIND_DN: z.string().default(''),
    LDAP_BIND_PASSWORD: z.string().default(''),
    LDAP_BASE_DN: z.string().default(''),
    /** `{login}` = o que a pessoa digitou (escapado). Vazio = padrao do AD. */
    LDAP_USER_FILTER: z.string().default(''),
    LDAP_ATTR_NAME: z.string().default('displayName'),
    LDAP_ATTR_MAIL: z.string().default('mail'),
    /** DNs dos grupos (memberOf) que dao o papel; sem grupo = usuario comum. */
    LDAP_ANALYST_GROUP: z.string().default(''),
    LDAP_ADMIN_GROUP: z.string().default(''),
    LDAP_NESTED_GROUPS: z.enum(['true', 'false']).default('false'),
    /** Validade da senha em dias (admins nao expiram). 0 = sem validade. */
    PASSWORD_MAX_AGE_DAYS: z.coerce.number().int().min(0).max(3650).default(90),
    /**
     * Reputacao externa: consulta automatica no envio (so SHA-256 ou dominio/IP).
     * Cada servico liga com a sua chave; vazio = desligado.
     */
    VT_API_KEY: z.string().default(''),
    /** Uma chave da abuse.ch serve para MalwareBazaar, URLhaus e ThreatFox. */
    ABUSECH_AUTH_KEY: z.string().default(''),
    ABUSEIPDB_API_KEY: z.string().default(''),
    /**
     * Enriquecimento de links (revisao de novembro, 3.3; lib/link-enrichment.ts). RDAP (registro
     * do dominio) e Certificate Transparency (crt.sh) nao pedem chave, entao so ligam por opcao
     * explicita: sem isso, nenhum dominio sai para eles. O DNS passivo usa a chave do VirusTotal.
     */
    RDAP_ENABLED: z.enum(['true', 'false']).default('false'),
    CT_ENABLED: z.enum(['true', 'false']).default('false'),
    PASSIVE_DNS_ENABLED: z.enum(['true', 'false']).default('true'),
    /** Antivirus ClamAV (contenor clamav, protocolo clamd). Vazio = desligado. */
    CLAMAV_HOST: z.string().default(''),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    /**
     * Captura da pagina de um link (item 80): servico do navegador isolado
     * (conteiner capture) e o token compartilhado. Vazio = desligada.
     */
    CAPTURE_URL: z.string().default(''),
    CAPTURE_TOKEN: z
      .string()
      .refine((t) => t === '' || t.length >= 16, 'use 16 caracteres ou mais')
      .default(''),
    /**
     * Analise de funcoes (item 7.2): servico capa (capa e FLOSS, sem rede) e o token
     * compartilhado. Vazio = desligada.
     */
    CAPA_URL: z.string().default(''),
    CAPA_TOKEN: z
      .string()
      .refine((t) => t === '' || t.length >= 16, 'use 16 caracteres ou mais')
      .default(''),
    /** Executaveis maiores que isto nao vao para o capa (o servico tem o mesmo teto). */
    CAPA_MAX_MB: z.coerce.number().int().min(1).max(200).default(32),
    /** Espera por uma analise: acima da soma dos tetos do capa e do FLOSS no servico. */
    CAPA_REQUEST_TIMEOUT_S: z.coerce.number().int().min(30).default(1000),
    /**
     * Analise com o Ghidra (item 7.3): servico ghidra (sob demanda, sem rede) e o token
     * compartilhado. Vazio = desligada.
     */
    GHIDRA_URL: z.string().default(''),
    GHIDRA_TOKEN: z
      .string()
      .refine((t) => t === '' || t.length >= 16, 'use 16 caracteres ou mais')
      .default(''),
    GHIDRA_MAX_MB: z.coerce.number().int().min(1).max(200).default(32),
    /** Espera por uma analise: acima do teto do servico (GHIDRA_TIMEOUT_S) mais o empacotamento. */
    GHIDRA_REQUEST_TIMEOUT_S: z.coerce.number().int().min(30).default(1300),
    /**
     * Desempacotar e extrair (item 7.8): servico unpack (upx, 7-Zip, innoextract,
     * pyinstxtractor; sem rede) e o token compartilhado. Vazio = desligado.
     */
    UNPACK_URL: z.string().default(''),
    UNPACK_TOKEN: z
      .string()
      .refine((t) => t === '' || t.length >= 16, 'use 16 caracteres ou mais')
      .default(''),
    UNPACK_MAX_MB: z.coerce.number().int().min(1).max(200).default(64),
    UNPACK_REQUEST_TIMEOUT_S: z.coerce.number().int().min(30).default(400),
    /**
     * Office e PDF mais fundo (item 7.14; revisao de novembro, 3.2): servico oletools (olevba,
     * MacroRaptor, msodde, oleid, rtfobj; sem rede) e o token compartilhado. Vazio = desligado.
     */
    OLETOOLS_URL: z.string().default(''),
    OLETOOLS_TOKEN: z
      .string()
      .refine((t) => t === '' || t.length >= 16, 'use 16 caracteres ou mais')
      .default(''),
    OLETOOLS_MAX_MB: z.coerce.number().int().min(1).max(200).default(32),
    OLETOOLS_REQUEST_TIMEOUT_S: z.coerce.number().int().min(30).default(300),
    /** Relatorio so e publicado com a aprovacao de outro analista (quatro olhos). */
    REPORT_REVIEW_REQUIRED: z.enum(['true', 'false']).default('false'),
    SANDBOX_CONSOLE_ENABLED: z.enum(['true', 'false']).default('true'),
    PROXMOX_MOCK: z.enum(['true', 'false']).default('false'),
    PROXMOX_API_URL: z.string().default(''),
    PROXMOX_NODE: z.string().default('pve'),
    PROXMOX_USER: z.string().default(''),
    PROXMOX_PASSWORD: z.string().default(''),
    PROXMOX_TEMPLATE_VMID: z.coerce.number().default(0),
    PROXMOX_ISO_STORAGE: z.string().default('local'),
    PROXMOX_VERIFY_TLS: z.enum(['true', 'false']).default('false'),
    SANDBOX_TAG: z.string().default('deeplook-sandbox'),
    SANDBOX_TTL_MINUTES: z.coerce.number().min(5).max(1440).default(60),
    SANDBOX_MAX_ACTIVE: z.coerce.number().min(1).default(4),
    SANDBOX_MAX_PER_USER: z.coerce.number().min(1).default(2),
    SANDBOX_MOCK_VNC_URL: z.string().default(''),
    /**
     * Artefatos do sandbox (revisao de novembro, 3.7): a cada N segundos, enquanto o ambiente roda,
     * a API guarda um print da tela e a lista de processos (pelo qemu-guest-agent). 0 desliga.
     */
    SANDBOX_ARTIFACT_INTERVAL_S: z.coerce.number().int().min(0).max(3600).default(60),
    /** Prints guardados por ambiente (o primeiro e os mais recentes ficam). */
    SANDBOX_ARTIFACT_MAX_SHOTS: z.coerce.number().int().min(1).max(500).default(60),
  })
  .superRefine((value, ctx) => {
    // Sem sandbox ligado (ou em modo mock) nao exigimos nada do Proxmox.
    if (value.SANDBOX_ENABLED !== 'true' || value.PROXMOX_MOCK === 'true') return;

    const required: [string, string][] = [
      ['PROXMOX_API_URL', value.PROXMOX_API_URL],
      ['PROXMOX_USER', value.PROXMOX_USER],
      ['PROXMOX_PASSWORD', value.PROXMOX_PASSWORD],
    ];
    for (const [name, val] of required) {
      if (!val) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} e obrigatoria quando SANDBOX_ENABLED=true sem PROXMOX_MOCK`,
        });
      }
    }
    if (!value.PROXMOX_TEMPLATE_VMID) {
      ctx.addIssue({
        code: 'custom',
        path: ['PROXMOX_TEMPLATE_VMID'],
        message: 'PROXMOX_TEMPLATE_VMID e obrigatorio quando SANDBOX_ENABLED=true sem PROXMOX_MOCK',
      });
    }
  });

// Segredos por arquivo (NOME_FILE, plano pos-revisao 5.1): lidos antes de validar.
try {
  loadSecretFiles();
} catch (err) {
  console.error(`[env] ${(err as Error).message}`);
  process.exit(1);
}

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Variaveis de ambiente invalidas:');

  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/** Valores do compose e do .env.example: publicos, nao servem como segredo (item 97). */
const KNOWN_SECRETS = new Set([
  'change-me-please-use-a-long-random-secret',
  'troque-este-token-da-captura',
  'troque-este-token-do-capa',
  'troque-este-token-do-ghidra',
  'troque-este-token-do-unpack',
  'troque-este-token-do-oletools',
]);
/**
 * Senhas do banco e do MinIO que o compose e o .env.example trazem: publicas tambem. Com elas,
 * quem alcanca o console do MinIO (127.0.0.1:9001) baixa todas as amostras. O status do sistema
 * (lib/status.ts) usa as mesmas listas.
 */
export const PUBLIC_DB_PASSWORDS = ['deeplook', 'change-me-db-password'];
export const PUBLIC_S3_SECRETS = ['deeplook123', 'change-me-minio-password'];

/** Senha dentro do DATABASE_URL ('' se o endereco vier noutro formato: nao da para conferir). */
export function databasePassword(): string {
  try {
    return decodeURIComponent(new URL(env.DATABASE_URL).password);
  } catch {
    return '';
  }
}

/** Em producao o SESSION_SECRET curto (ex.: literais de teste) assinaria o cookie de
 * dispositivo e puloria o bloqueio da conta: exija entropia minima (item 97). */
const MIN_PROD_SECRET = 32;
const refused = [
  (KNOWN_SECRETS.has(env.SESSION_SECRET) || env.SESSION_SECRET.length < MIN_PROD_SECRET) &&
    'SESSION_SECRET',
  env.CAPTURE_URL && KNOWN_SECRETS.has(env.CAPTURE_TOKEN) && 'CAPTURE_TOKEN',
  env.CAPA_URL && KNOWN_SECRETS.has(env.CAPA_TOKEN) && 'CAPA_TOKEN',
  env.GHIDRA_URL && KNOWN_SECRETS.has(env.GHIDRA_TOKEN) && 'GHIDRA_TOKEN',
  env.UNPACK_URL && KNOWN_SECRETS.has(env.UNPACK_TOKEN) && 'UNPACK_TOKEN',
  env.OLETOOLS_URL && KNOWN_SECRETS.has(env.OLETOOLS_TOKEN) && 'OLETOOLS_TOKEN',
  PUBLIC_DB_PASSWORDS.includes(databasePassword()) && 'POSTGRES_PASSWORD',
  PUBLIC_S3_SECRETS.includes(env.S3_SECRET_KEY) && 'S3_SECRET_KEY',
  // Igual ao SESSION_SECRET nao separa nada: quem tem um tem o outro.
  env.DATA_KEY !== '' &&
    env.DATA_KEY === env.SESSION_SECRET &&
    'DATA_KEY (igual ao SESSION_SECRET)',
].filter((name): name is string => Boolean(name));
if (refused.length && isProd && env.ALLOW_INSECURE_DEFAULTS !== 'true') {
  console.error(
    `[env] ${refused.join(' e ')} com valor publico ou curto demais (minimo de ` +
      `${MIN_PROD_SECRET} caracteres no SESSION_SECRET em producao). Defina um valor longo e ` +
      'aleatorio no .env (ex.: openssl rand -hex 32). Para uma demonstracao local, use ' +
      'ALLOW_INSECURE_DEFAULTS=true.',
  );
  if (refused.includes('POSTGRES_PASSWORD')) {
    console.error(
      '[env] Num banco que ja existe, mudar o .env nao muda a senha gravada: troque-a antes com ' +
        'ALTER USER (passo a passo em docs/implantacao.md).',
    );
  }
  if (refused.includes('S3_SECRET_KEY')) {
    console.error('[env] O S3_SECRET_KEY tem de ser igual ao MINIO_ROOT_PASSWORD.');
  }
  process.exit(1);
}

/** Sandbox ligado? (precisa ser explicito: SANDBOX_ENABLED=true) */
export const sandboxEnabled = env.SANDBOX_ENABLED === 'true';

/** Modo simulado: nao fala com o Proxmox real (desenvolvimento/testes). */
export const proxmoxMock = env.PROXMOX_MOCK === 'true';
