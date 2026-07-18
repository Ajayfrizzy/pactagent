ALTER TABLE "WebhookEndpoint"
  ADD COLUMN "encryptionKeyVersion" TEXT;

UPDATE "WebhookEndpoint"
SET "encryptionKeyVersion" = CASE
  WHEN "secretCiphertext" LIKE 'v1.%' THEN 'legacy'
  WHEN "secretCiphertext" LIKE 'v2.%' THEN split_part("secretCiphertext", '.', 2)
  ELSE NULL
END
WHERE "secretCiphertext" IS NOT NULL;

CREATE INDEX "WebhookEndpoint_encryptionKeyVersion_idx"
  ON "WebhookEndpoint"("encryptionKeyVersion");
