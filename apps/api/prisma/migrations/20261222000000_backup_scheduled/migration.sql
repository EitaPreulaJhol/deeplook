-- Backup gerado pelo agendamento (item 6.13), e nao por um admin na tela.
ALTER TABLE "Backup" ADD COLUMN     "scheduled" BOOLEAN NOT NULL DEFAULT false;
