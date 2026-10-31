-- Synthetic populated PRE-M1 fixture, never production data.
INSERT INTO "App" (id,name,slug,"ownerId","updatedAt") VALUES ('m1-upgrade-app','M1 upgrade','m1-upgrade','fixture',now());
INSERT INTO "Agreement" (id,"appId",title,description,amount,currency,"deadlineAt","updatedAt")
SELECT 'm1-agreement-' || rail,'m1-upgrade-app',rail,'fixture','10000000000','CKB',now() + interval '1 day',now()
FROM unnest(ARRAY['ckb','manual','mock']) rail;
INSERT INTO "Milestone" (id,"appId","agreementId",title,description,amount,currency,"sortOrder","updatedAt")
SELECT 'm1-milestone-' || rail,'m1-upgrade-app','m1-agreement-' || rail,rail,'fixture','10000000000','CKB',1,now()
FROM unnest(ARRAY['ckb','manual','mock']) rail;
INSERT INTO "Escrow" (id,"appId","agreementId","milestoneId",amount,currency,rail,network,status,
 "lockTxHash","lockOutputIndex","lockScriptJson","clientLockScriptJson","workerLockScriptJson","cellData","contractVersion","refundTimeoutSince","updatedAt")
SELECT 'm1-escrow-' || rail,'m1-upgrade-app','m1-agreement-' || rail,'m1-milestone-' || rail,'10000000000','CKB',rail,
 CASE WHEN rail='ckb' THEN 'testnet' ELSE 'sandbox' END,'funded',
 CASE WHEN rail='ckb' THEN '0x' || repeat('ab',32) ELSE NULL END,
 CASE WHEN rail='ckb' THEN 2 ELSE NULL END,
 CASE WHEN rail='ckb' THEN '{"codeHash":"0xabababababababababababababababababababababababababababababababab","hashType":"data1","args":"0x001122"}' ELSE NULL END,
 CASE WHEN rail='ckb' THEN '{"args":"0x0011"}' ELSE NULL END,
 CASE WHEN rail='ckb' THEN '{"args":"0x2233"}' ELSE NULL END,
 CASE WHEN rail='ckb' THEN '0x' || repeat('00',88) ELSE NULL END,
 CASE WHEN rail='ckb' THEN 1 ELSE NULL END,
 CASE WHEN rail='ckb' THEN '100' ELSE NULL END,now()
FROM unnest(ARRAY['ckb','manual','mock']) rail;
INSERT INTO "Transaction" (id,"appId","agreementId","milestoneId","escrowId",type,rail,network,status,"txHash",amount,currency,"updatedAt")
SELECT 'm1-tx-'||rail,"appId","agreementId","milestoneId",id,'lock',rail,network,'confirmed',"lockTxHash",amount,currency,now() FROM "Escrow";
-- Snapshot EVERY old column, including timestamps, bytes and identifiers.
CREATE TABLE m1_fixture_snapshot AS
 SELECT 'Agreement' AS source,id,to_jsonb(t) AS record FROM "Agreement" t
 UNION ALL SELECT 'Milestone',id,to_jsonb(t) FROM "Milestone" t
 UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t
 UNION ALL SELECT 'Transaction',id,to_jsonb(t) FROM "Transaction" t;
