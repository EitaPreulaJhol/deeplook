import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('production'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET deve ter ao menos 16 caracteres'),
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
    /** Demonstracao local: sobe mesmo com segredos padrao (nunca em producao de verdade). */
    ALLOW_INSECURE_DEFAULTS: z.enum(['true', 'false']).default('false'),
    ADMIN_EMAIL: z.string().email().default('admin@deeplook.local'),
    ADMIN_PASSWORD: z.string().min(6).default('admin12345'),
    ADMIN_NAME: z.string().default('Administrator'),
    MAX_UPLOAD_MB: z.coerce.number().default(200),
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
]);
const refused = [
  KNOWN_SECRETS.has(env.SESSION_SECRET) && 'SESSION_SECRET',
  env.CAPTURE_URL && KNOWN_SECRETS.has(env.CAPTURE_TOKEN) && 'CAPTURE_TOKEN',
].filter(Boolean);
if (refused.length && isProd && env.ALLOW_INSECURE_DEFAULTS !== 'true') {
  console.error(
    `[env] ${refused.join(' e ')} com o valor padrao, que e publico. Defina um valor longo e ` +
      'aleatorio no .env (ex.: openssl rand -hex 32). Para uma demonstracao local, use ' +
      'ALLOW_INSECURE_DEFAULTS=true.',
  );
  process.exit(1);
}

/** Sandbox ligado? (precisa ser explicito: SANDBOX_ENABLED=true) */
export const sandboxEnabled = env.SANDBOX_ENABLED === 'true';

/** Modo simulado: nao fala com o Proxmox real (desenvolvimento/testes). */
export const proxmoxMock = env.PROXMOX_MOCK === 'true';
