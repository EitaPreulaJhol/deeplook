-- Opcoes de inicio do ambiente (plans/ajustes-usabilidade, item 5): o analista pode desligar a
-- captura de rede daquele ambiente.
ALTER TABLE "SandboxSession" ADD COLUMN "captureOff" BOOLEAN NOT NULL DEFAULT false;
