DO $$
DECLARE changed bigint;
BEGIN
 SELECT count(*) INTO changed FROM (
   (SELECT * FROM m1_review_snapshot EXCEPT
    (SELECT 'App',id,to_jsonb(t) FROM "App" t UNION ALL SELECT 'Agreement',id,to_jsonb(t) FROM "Agreement" t
     UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t UNION ALL SELECT 'EscrowFoundation',id,to_jsonb(t) FROM "EscrowFoundation" t))
   UNION ALL
   ((SELECT 'App',id,to_jsonb(t) FROM "App" t UNION ALL SELECT 'Agreement',id,to_jsonb(t) FROM "Agreement" t
     UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t UNION ALL SELECT 'EscrowFoundation',id,to_jsonb(t) FROM "EscrowFoundation" t)
    EXCEPT SELECT * FROM m1_review_snapshot)
 ) diff;
 IF changed <> 0 THEN RAISE EXCEPTION 'Correction changed % existing records', changed; END IF;
 IF (SELECT count(*) FROM "EscrowFoundation") <> 1 THEN RAISE EXCEPTION 'Missing M1 fixture'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"EscrowFoundation"'::regclass AND conname='EscrowFoundation_exact_client_fee_check' AND convalidated) THEN
   RAISE EXCEPTION 'Exact fee constraint was not validated';
 END IF;
END $$;
