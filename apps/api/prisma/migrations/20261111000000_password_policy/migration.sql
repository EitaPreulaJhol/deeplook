-- Politica de senha (item 51): validade contada da ultima troca.
-- Contas existentes comecam a contar a partir desta migracao.
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
