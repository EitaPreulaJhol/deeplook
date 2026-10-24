-- CreateEnum
CREATE TYPE "KbCategory" AS ENUM ('MALWARE_FAMILY', 'SCAM', 'TECHNIQUE', 'PROCEDURE');

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" "KbCategory" NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "editorId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ReportKbArticles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReportKbArticles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_title_key" ON "KbArticle"("title");

-- CreateIndex
CREATE INDEX "KbArticle_category_updatedAt_idx" ON "KbArticle"("category", "updatedAt");

-- CreateIndex
CREATE INDEX "KbArticleRevision_articleId_createdAt_idx" ON "KbArticleRevision"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "_ReportKbArticles_B_index" ON "_ReportKbArticles"("B");

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticleRevision" ADD CONSTRAINT "KbArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticleRevision" ADD CONSTRAINT "KbArticleRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportKbArticles" ADD CONSTRAINT "_ReportKbArticles_A_fkey" FOREIGN KEY ("A") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReportKbArticles" ADD CONSTRAINT "_ReportKbArticles_B_fkey" FOREIGN KEY ("B") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

