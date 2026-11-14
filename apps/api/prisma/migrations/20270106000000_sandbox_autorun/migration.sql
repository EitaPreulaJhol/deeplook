-- Execucao automatica da amostra no ambiente isolado: pedida ao abrir, roda depois do boot e do
-- Sysmon, na sessao do usuario logado da VM.
CREATE TYPE "SandboxAutoRunStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

ALTER TABLE "SandboxSession" ADD COLUMN "autoRun" "SandboxAutoRunStatus",
ADD COLUMN "autoRunAt" TIMESTAMP(3),
ADD COLUMN "autoRunUser" TEXT,
ADD COLUMN "autoRunSysmon" BOOLEAN,
ADD COLUMN "autoRunError" TEXT;

ALTER TYPE "EntryEventType" ADD VALUE 'SANDBOX_AUTORUN' AFTER 'SANDBOX_FAILED';
