import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET deve ter ao menos 16 caracteres'),
  SESSION_TTL_HOURS: z.coerce.number().default(168),
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
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Variaveis de ambiente invalidas:');

  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
