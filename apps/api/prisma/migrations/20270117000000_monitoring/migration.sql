-- Monitoramento (plans/monitoramento): acoes do admin na auditoria, o aviso ao dono do ambiente
-- encerrado e as amostras por minuto das metricas (7 dias).
ALTER TYPE "AuditAction" ADD VALUE 'SANDBOX_STOPPED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKER_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKER_RESUMED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_RETRIED';
ALTER TYPE "NotificationType" ADD VALUE 'SANDBOX_STOPPED_BY_ADMIN';

CREATE TABLE "MonitorSample" (
    "at" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MonitorSample_pkey" PRIMARY KEY ("key", "at")
);

CREATE INDEX "MonitorSample_at_idx" ON "MonitorSample"("at");
