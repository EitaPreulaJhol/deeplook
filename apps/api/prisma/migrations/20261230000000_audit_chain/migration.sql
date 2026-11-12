-- Auditoria com encadeamento de hash (revisao de novembro, item 1.3). Cada evento leva o numero
-- de sequencia, o hash do anterior e o proprio hash; actorRef e targetRef guardam os ids como
-- estavam na gravacao (sem chave estrangeira: nao mudam se a conta for apagada). As colunas
-- nascem vazias: a API encadeia o historico na primeira gravacao ou na subida.
ALTER TABLE "AuditEvent"
  ADD COLUMN "seq" INTEGER,
  ADD COLUMN "prevHash" TEXT,
  ADD COLUMN "hash" TEXT,
  ADD COLUMN "actorRef" TEXT,
  ADD COLUMN "targetRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");
