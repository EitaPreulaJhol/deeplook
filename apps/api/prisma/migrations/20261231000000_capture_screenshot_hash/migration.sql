-- Hash perceptual do print da captura (revisao de novembro, item 3.4): 256 bits em hexadecimal,
-- calculado no servico de captura. Paginas com a mesma aparencia tem hashes proximos, o que liga
-- kits de phishing hospedados em dominios diferentes. Nulo nas capturas antigas e nas paginas
-- sem estrutura (em branco).
ALTER TABLE "PageCapture" ADD COLUMN "screenshotHash" TEXT;

-- CreateIndex
CREATE INDEX "PageCapture_screenshotHash_idx" ON "PageCapture"("screenshotHash");
