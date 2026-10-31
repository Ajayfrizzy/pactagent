-- Populated merged-M1 state, before the forward review correction.
INSERT INTO "App" (id,name,slug,"ownerId","updatedAt") VALUES ('m1-review-app','Review upgrade','m1-review','fixture',now());
INSERT INTO "Agreement" (id,"appId",title,description,amount,"deadlineAt","updatedAt")
VALUES ('m1-review-agreement','m1-review-app','Review','fixture','1000',now(),now());
INSERT INTO "Escrow" (id,"appId","agreementId",amount,currency,rail,network,status,"updatedAt")
VALUES ('m1-review-escrow','m1-review-app','m1-review-agreement','1000','CKB','mock','sandbox','not_created',now());
INSERT INTO "EscrowFoundation" (id,"appId","escrowId","agreementId","assetId",network,"deploymentId",
 "termsHash","canonicalTerms",principal,"clientFeeDeposit","clientFeeBps","workerFeeBps","maxBaseUnits","finalityPolicyVersion")
VALUES ('m1-review-foundation','m1-review-app','m1-review-escrow','m1-review-agreement',
 'asset:v1:sandbox:local/synthetic:units','sandbox:local','synthetic:v1',repeat('a',64),'{"fixture":"prospective"}',
 '1000','20',200,300,'115792089237316195423570985008687907853269984665640564039457584007913129639935','unavailable-v1');
CREATE TABLE m1_review_snapshot AS
 SELECT 'App' AS source,id,to_jsonb(t) AS record FROM "App" t
 UNION ALL SELECT 'Agreement',id,to_jsonb(t) FROM "Agreement" t
 UNION ALL SELECT 'Escrow',id,to_jsonb(t) FROM "Escrow" t
 UNION ALL SELECT 'EscrowFoundation',id,to_jsonb(t) FROM "EscrowFoundation" t;
