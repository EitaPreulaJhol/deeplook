-- Passkeys (WebAuthn) como login alternativo, cadastradas em Minha Conta.
ALTER TYPE "AuditAction" ADD VALUE 'PASSKEY_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSKEY_REMOVED';

CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasskeyChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasskeyChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
CREATE INDEX "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");

ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
