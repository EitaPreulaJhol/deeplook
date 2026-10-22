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
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    ADMIN_EMAIL: z.string().email().default('admin@deeplook.local'),
    ADMIN_PASSWORD: z.string().min(6).default('admin12345'),
    ADMIN_NAME: z.string().default('Administrator'),
    MAX_UPLOAD_MB: z.coerce.number().default(200),
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
    /**
     * Reputacao externa: consulta automatica no envio (so SHA-256 ou dominio/IP).
     * Cada servico liga com a sua chave; vazio = desligado.
     */
    VT_API_KEY: z.string().default(''),
    /** Uma chave da abuse.ch serve para MalwareBazaar, URLhaus e ThreatFox. */
    ABUSECH_AUTH_KEY: z.string().default(''),
    ABUSEIPDB_API_KEY: z.string().default(''),
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
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} e obrigatoria quando SANDBOX_ENABLED=true sem PROXMOX_MOCK`,
        });
      }
    }
    if (!value.PROXMOX_TEMPLATE_VMID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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

/** Sandbox ligado? (precisa ser explicito: SANDBOX_ENABLED=true) */
export const sandboxEnabled = env.SANDBOX_ENABLED === 'true';

/** Modo simulado: nao fala com o Proxmox real (desenvolvimento/testes). */
export const proxmoxMock = env.PROXMOX_MOCK === 'true';
