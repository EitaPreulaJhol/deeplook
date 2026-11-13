-- Sysmon no template (plano pos-revisao, item 5.3): o resumo do que o Sysmon registrou na VM,
-- lido pelo agente do guest a cada coleta dos artefatos.
ALTER TYPE "SandboxArtifactKind" ADD VALUE 'SYSMON';

ALTER TABLE "SandboxArtifact" ADD COLUMN "sysmon" JSONB;
