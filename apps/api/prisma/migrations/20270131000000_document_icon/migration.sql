-- Icones de documento marcados pelo admin (plans/analise-estatica-ampliada, item 2).
CREATE TABLE "DocumentIcon" (
    "hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "DocumentIcon_pkey" PRIMARY KEY ("hash")
);
