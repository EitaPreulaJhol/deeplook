-- Busca nos eventos do sandbox (plans/caca-e-formatos, item 2): indice de trigramas sobre o texto
-- do evento, que atende o "contem" em qualquer campo. O Prisma nao representa indice de expressao:
-- ele fica fora do schema.prisma, e o `prisma migrate diff` o ignora. Sem permissao para criar a
-- extensao, a busca funciona sem o indice, mais lenta.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
  RAISE NOTICE 'pg_trgm indisponivel: a busca no sandbox fica sem o indice de trigramas';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "SandboxSysmonEvent_data_trgm_idx"
      ON "SandboxSysmonEvent" USING gin (("data"::text) gin_trgm_ops);
  END IF;
END $$;
