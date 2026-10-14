-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "fundings" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "FundingStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'SIMULATED',
    "providerRef" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fundings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fundings_reference_key" ON "fundings"("reference");

-- CreateIndex
CREATE INDEX "fundings_walletId_createdAt_idx" ON "fundings"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "fundings_status_createdAt_idx" ON "fundings"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "fundings" ADD CONSTRAINT "fundings_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
