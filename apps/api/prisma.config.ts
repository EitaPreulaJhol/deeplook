import { defineConfig } from 'prisma/config';

import { loadSecretFiles } from './src/secret-files';

// DATABASE_URL_FILE (segredo por arquivo, plano pos-revisao 5.1) vale tambem nas migracoes.
loadSecretFiles();

/**
 * Configuracao do Prisma 7 (CLI): schema, migracoes, seed e banco. O Prisma 7
 * nao le o .env sozinho: as variaveis vem do ambiente (docker-compose ou shell).
 * Sem DATABASE_URL (ex.: `prisma generate` no build da imagem) o banco nao e usado.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // So para quem gera migracoes (`prisma migrate diff`/`dev`).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
