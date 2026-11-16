-- Regras Sigma da equipe (plans/caca-e-formatos, item 1): o YAML, quem criou e editou, e quando
-- terminou a avaliacao sobre os eventos ja guardados. O indice por regra serve para apagar e contar
-- as deteccoes de uma regra em todas as execucoes.

ALTER TYPE "AuditAction" ADD VALUE 'SIGMA_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SIGMA_RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SIGMA_RULE_DELETED';

-- CreateTable
CREATE TABLE "SigmaRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "evaluatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigmaRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SigmaRule_name_key" ON "SigmaRule"("name");

-- CreateIndex
CREATE INDEX "SandboxSigmaHit_ruleId_idx" ON "SandboxSigmaHit"("ruleId");

-- AddForeignKey
ALTER TABLE "SigmaRule" ADD CONSTRAINT "SigmaRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigmaRule" ADD CONSTRAINT "SigmaRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

