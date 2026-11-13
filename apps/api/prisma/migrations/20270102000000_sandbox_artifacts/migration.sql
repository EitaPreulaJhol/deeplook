-- Artefatos do sandbox (revisao de novembro, item 3.7): prints periodicos da tela da VM e a lista
-- de processos pelo agente do guest, enquanto o ambiente roda.
CREATE TYPE "SandboxArtifactKind" AS ENUM ('SCREENSHOT', 'PROCESSES');

CREATE TABLE "SandboxArtifact" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "SandboxArtifactKind" NOT NULL,
    "storageKey" TEXT,
    "processes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SandboxArtifact_sessionId_createdAt_idx" ON "SandboxArtifact"("sessionId", "createdAt");

ALTER TABLE "SandboxArtifact" ADD CONSTRAINT "SandboxArtifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SandboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Por que a coleta de processos nao funciona (agente ausente, sem permissao): mostrado na tela.
ALTER TABLE "SandboxSession" ADD COLUMN "artifactsNote" TEXT;
