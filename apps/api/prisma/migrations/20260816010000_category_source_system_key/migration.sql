-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "sourceSystemKey" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "categories_workspaceId_sourceSystemKey_key" ON "categories"("workspaceId", "sourceSystemKey");

