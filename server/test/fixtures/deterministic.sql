BEGIN;

DELETE FROM "App" WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO "App" (id, "ownerId", name, slug, environment, status, "defaultCurrency", "defaultNetwork", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'fixture-owner',
  'Local Fixture App',
  'local-fixture-app',
  'sandbox',
  'active',
  'CKB',
  'sandbox',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
);

COMMIT;
