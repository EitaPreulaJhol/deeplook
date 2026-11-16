-- Regras Sigma sobre o Sysmon do sandbox (plans/novas-analises, item 1): os eventos ganham a marca
-- de ja avaliados, e as deteccoes ficam numa tabela por ambiente (uma linha por regra e processo).
ALTER TABLE "SandboxSysmonEvent" ADD COLUMN "sigmaChecked" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "SandboxSysmonEvent_sessionId_sigmaChecked_idx" ON "SandboxSysmonEvent"("sessionId", "sigmaChecked");

CREATE TABLE "SandboxSigmaHit" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "techniques" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processGuid" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "eventId" INTEGER NOT NULL,
    "event" JSONB NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxSigmaHit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SandboxSigmaHit_sessionId_ruleId_processGuid_key" ON "SandboxSigmaHit"("sessionId", "ruleId", "processGuid");
CREATE INDEX "SandboxSigmaHit_sessionId_level_idx" ON "SandboxSigmaHit"("sessionId", "level");
ALTER TABLE "SandboxSigmaHit" ADD CONSTRAINT "SandboxSigmaHit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SandboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
