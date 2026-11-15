-- Eventos do Sysmon de cada ambiente, lidos aos poucos (plans/sandbox-execucoes, fase 2).
CREATE TABLE "SandboxSysmonEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordId" BIGINT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "image" TEXT,
    "processGuid" TEXT,
    "parentGuid" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "SandboxSysmonEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SandboxSysmonEvent_sessionId_time_idx" ON "SandboxSysmonEvent"("sessionId", "time");

CREATE INDEX "SandboxSysmonEvent_sessionId_processGuid_idx" ON "SandboxSysmonEvent"("sessionId", "processGuid");

CREATE UNIQUE INDEX "SandboxSysmonEvent_sessionId_recordId_time_key" ON "SandboxSysmonEvent"("sessionId", "recordId", "time");

ALTER TABLE "SandboxSysmonEvent" ADD CONSTRAINT "SandboxSysmonEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SandboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
