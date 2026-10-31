DO $$
DECLARE changed bigint;
BEGIN
 SELECT count(*) INTO changed FROM (
   (SELECT * FROM m1_fixture_snapshot EXCEPT
    (SELECT 'Agreement',id,to_jsonb(t) FROM "Agreement" t UNION ALL SELECT 'Milestone',id,to_jsonb(t) FROM "Milestone" t
     UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t UNION ALL SELECT 'Transaction',id,to_jsonb(t) FROM "Transaction" t))
   UNION ALL
   ((SELECT 'Agreement',id,to_jsonb(t) FROM "Agreement" t UNION ALL SELECT 'Milestone',id,to_jsonb(t) FROM "Milestone" t
     UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t UNION ALL SELECT 'Transaction',id,to_jsonb(t) FROM "Transaction" t)
    EXCEPT SELECT * FROM m1_fixture_snapshot)
 ) diff;
 IF changed <> 0 THEN RAISE EXCEPTION 'M1 changed % legacy records', changed; END IF;
 IF (SELECT count(*) FROM "Escrow") <> 3 THEN RAISE EXCEPTION 'Missing populated fixture'; END IF;
 IF EXISTS(SELECT 1 FROM "EscrowFoundation") THEN RAISE EXCEPTION 'Unexpected historical backfill'; END IF;
END $$;
-- Old-reader/old-writer compatibility on expanded schema.
UPDATE "Agreement" SET title='Legacy reader/writer still works' WHERE id='m1-agreement-mock';
DO $$ BEGIN
 IF (SELECT "cellData" FROM "Escrow" WHERE id='m1-escrow-ckb') <> ('0x' || repeat('00',88)) THEN RAISE EXCEPTION 'CKB bytes changed'; END IF;
END $$;
