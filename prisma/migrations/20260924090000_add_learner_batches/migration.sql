-- CreateTable
CREATE TABLE "batches" (
    "id" VARCHAR(25) NOT NULL,
    "orgId" VARCHAR(25) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_orgId_idx" ON "batches"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "batches_orgId_name_key" ON "batches"("orgId", "name");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "batchId" VARCHAR(25);

-- CreateIndex
CREATE INDEX "users_batchId_idx" ON "users"("batchId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
