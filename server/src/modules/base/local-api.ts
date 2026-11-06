import { Router } from 'express';
import { z } from 'zod';
import { requireApiKey } from '../api-keys/api-key.middleware';
import { requireScope } from '../auth/rbac.middleware';
import { asyncHandler } from '../../common/middleware/async-handler';
import type { LocalLifecycle } from './local-lifecycle';
import type { Terms } from './codec';
const text=z.string().min(1).max(200), decimal=z.string().regex(/^(0|[1-9]\d{0,77})$/);
const hash=z.string().regex(/^0x[0-9a-fA-F]{64}$/), address=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const terms=z.object({appId:hash,agreementId:hash,milestoneId:hash,escrowId:hash,applicationCommitment:hash,
  token:address,client:address,worker:address,treasury:address,principal:decimal,clientBps:decimal,workerBps:decimal,
  feePolicy:hash,fallbackWorker:decimal,disputeDeadline:decimal,finalDeadline:decimal,threshold:decimal,intervalPolicy:decimal,
  minDisputeInterval:decimal,arbiters:z.array(address).max(16)}).strict();
// Mounted ONLY by the explicit loopback test harness. Main app.ts never imports
// this router; no environment switch can activate public Base financial routes.
export function localFinancialRouter(service: LocalLifecycle) {
  const router=Router();
  router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({error:{code:'local_only'}});return;}next();});
  router.use(requireApiKey);
  router.post('/escrows',requireScope('escrows:v2:propose'),asyncHandler(async(req,res)=>{
    const input=z.object({agreementId:text,milestoneId:text,instance:address,terms}).strict().parse(req.body);
    const row=await service.register(req.tenant!,{...input,terms:input.terms as Terms});res.status(201).json({data:{id:row.id,termsHash:row.termsHash,localOnly:true}});
  }));
  router.post('/escrows/:id/signing-payload',requireScope('escrows:v2:read'),asyncHandler(async(req,res)=>{
    const input=z.object({action:z.enum(['funding','mutual','dispute','arbitration','cancel:0','cancel:1','cancel:2']),validUntil:decimal,workerAmount:decimal.optional()}).strict().parse(req.body);
    res.json({data:await service.signingPayload(req.tenant!,req.params.id,input.action,input.validUntil,input.workerAmount)});
  }));
  router.post('/escrows/:id/proposals',requireScope('escrows:v2:propose'),asyncHandler(async(req,res)=>{
    const input=z.object({idempotencyKey:text,signedTransaction:z.string().regex(/^0x[0-9a-fA-F]+$/).max(262144),replacesTransactionId:hash.optional()}).strict().parse(req.body);
    res.status(202).json({data:await service.propose(req.tenant!,req.params.id,input.idempotencyKey,input.signedTransaction,input.replacesTransactionId)});
  }));
  router.get('/operations/:id',requireScope('escrows:v2:read'),asyncHandler(async(req,res)=>res.json({data:await service.status(req.tenant!,req.params.id)})));
  return router;
}
