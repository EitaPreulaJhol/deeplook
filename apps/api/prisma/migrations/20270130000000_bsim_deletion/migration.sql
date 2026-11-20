-- Amostras apagadas de vez que ainda estao na base do BSim (plans/analise-estatica-ampliada, item 23).
CREATE TABLE "BsimDeletion" (
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BsimDeletion_pkey" PRIMARY KEY ("sha256")
);
