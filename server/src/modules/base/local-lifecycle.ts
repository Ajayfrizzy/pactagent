import { randomUUID } from 'node:crypto';
import { Transaction, keccak256 } from 'ethers';
import type { PrismaClient, BaseLocalCommand, Prisma } from '@prisma/client';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { conflict, notFound } from '../../common/errors/app-error';
import { createEvent } from '../events/event.repository';
import { canonicalJson } from '../escrows/funding-terms';
import { storeLocalEscrow } from './local.repository';
import { sealArtifact, openArtifact, sha256, type ArtifactKey } from './artifacts';
import { authorizationDigest, cancellationDigest, type Action, type Terms } from './codec';
import { LocalEvm } from './local-rpc';
import { checkLocalBinding, verifyLocalTransaction, localAbi, localEvidenceHash, type LocalDeployment } from './local-consent';
import { LocalBaseAdapter } from './adapter';

type Evidence = { state: 'unknown'|'included'|'finalized'|'reconciliation_required'; blockHash: string|null; blockNumber: string|null; reason: string };
export class LocalLifecycle {
  constructor(readonly db: PrismaClient, readonly evm: LocalEvm, private readonly key: ArtifactKey,
    private readonly trustedCodeHashes: ReadonlySet<string>) {
    this.trustedCodeHashes = new Set(trustedCodeHashes); // only harness configuration, never API input
  }
  private async binding(tenant: TenantContext, escrowId: string) {
    const row=await this.db.baseLocalEscrow.findFirst({where:{id:escrowId,appId:tenant.appId,chainId:31337}});
    if(!row) throw notFound();
    const terms=JSON.parse(row.canonicalTerms) as Terms;
    await this.evm.assertLocal();
    const code=await this.evm.provider.send('eth_getCode',[row.instance,'latest']);
    const codeHash=keccak256(code);
    if(!this.trustedCodeHashes.has(codeHash)) throw conflict('Local fixture bytecode is not trusted.','unverified_code');
    const binding={instance:row.instance,terms,codeHash};await checkLocalBinding(this.evm,binding);
    return {row,binding};
  }
  async register(tenant: TenantContext, input: Parameters<typeof storeLocalEscrow>[2]) {
    await this.evm.assertLocal();
    const code=await this.evm.provider.send('eth_getCode',[input.instance,'latest']);const codeHash=keccak256(code);
    if(!this.trustedCodeHashes.has(codeHash)) throw conflict('Unverified local fixture.','unverified_code');
    await checkLocalBinding(this.evm,{instance:input.instance,terms:input.terms,codeHash});
    return this.db.$transaction(tx=>storeLocalEscrow(tx,tenant,input));
  }
  async signingPayload(tenant: TenantContext, escrowId: string, action: Action|'cancel:0'|'cancel:1'|'cancel:2', expiry: string, workerAmount?: string) {
    const {row,binding}=await this.binding(tenant,escrowId);
    const n=action==='funding'?0:action==='mutual'?1:action==='arbitration'?2:action.startsWith('cancel:')?Number(action.slice(-1)):null;
    const result=n===null?null:await this.evm.provider.send('eth_call',[{to:binding.instance,data:localAbi.encodeFunctionData('intentEpoch',[n])},'latest']);
    const epoch=result?localAbi.decodeFunctionResult('intentEpoch',result)[0].toString():'0';
    const digest=action.startsWith('cancel:')?cancellationDigest(binding.terms,binding.instance,'31337',n as 0|1|2,epoch,expiry)
      :authorizationDigest({action:action as Action,terms:binding.terms,instance:binding.instance,chainId:'31337',validUntil:expiry,workerAmount,epoch});
    return {escrowId:row.id,chainId:31337,instance:binding.instance,terms:binding.terms,termsHash:row.termsHash,action,epoch,validUntil:expiry,digest,localOnly:true};
  }
  async propose(tenant: TenantContext, escrowId: string, idempotencyKey: string, raw: string, replacesTransactionId?:string) {
    if(!idempotencyKey || idempotencyKey.length>200 || raw.length>262144) throw conflict('Invalid proposal.','invalid_proposal');
    const requestHash=sha256(canonicalJson({escrowId,raw,...(replacesTransactionId?{replacesTransactionId}: {})}));
    const old=await this.db.baseLocalCommand.findUnique({where:{appId_idempotencyKey:{appId:tenant.appId,idempotencyKey}}});
    if(old) {if(old.requestHash!==requestHash) throw conflict('Idempotency payload differs.','idempotency_conflict');return this.status(tenant,old.id);}
    const {row,binding}=await this.binding(tenant,escrowId);
    let verified: Awaited<ReturnType<typeof verifyLocalTransaction>>;
    try { verified=await verifyLocalTransaction(this.evm,binding,raw); }
    catch { throw conflict('Participant consent, transaction or executable state is invalid.', 'consent_required'); }
    const id=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "App" WHERE "id"=${tenant.appId} FOR UPDATE`;
      const existing=await tx.baseLocalCommand.findUnique({where:{appId_idempotencyKey:{appId:tenant.appId,idempotencyKey}}});
      if(existing){if(existing.requestHash!==requestHash)throw conflict('Idempotency payload differs.','idempotency_conflict');return existing.id;}
      const id=randomUUID();
      await tx.baseLocalCommand.create({data:{id,appId:tenant.appId,escrowId,idempotencyKey,action:verified.action,epoch:verified.epoch,
        transactionId:verified.transactionId,replacesTransactionId,sender:verified.sender,nonce:verified.nonce,requestHash,codeHash:binding.codeHash,keyVersion:this.key.version,
        encryptedArtifact:sealArtifact(raw,this.key,`${tenant.appId}:${id}:${row.termsHash}`)}});
      // This row IS the transactional broadcast outbox; it contains no plaintext artifacts.
      await tx.baseLocalDispatch.create({data:{commandId:id,appId:tenant.appId}});
      await createEvent(tenant,{type:'base.local.operation.queued',agreementId:row.agreementId,milestoneId:row.milestoneId,payload:{operationId:id,localOnly:true,status:'queued'}},tx);
      return id;
    });
    return this.status(tenant,id);
  }
  async status(tenant: TenantContext, id: string) {
    const command=await this.db.baseLocalCommand.findFirst({where:{id,appId:tenant.appId}});if(!command)throw notFound();
    const dispatch=await this.db.baseLocalDispatch.findFirstOrThrow({where:{commandId:id,appId:tenant.appId}});
    return {id,escrowId:command.escrowId,action:command.action,epoch:command.epoch,transactionId:command.transactionId,
      status:dispatch.status,blockHash:dispatch.blockHash,localOnly:true};
  }
  private async recover(command: BaseLocalCommand) {
    if(command.keyVersion!==this.key.version)throw new Error('artifact_key_unavailable');
    const {row,binding}=await this.binding(tenantContext(command.appId),command.escrowId);
    if(binding.codeHash!==command.codeHash)throw new Error('code_changed');
    const raw=openArtifact(command.encryptedArtifact,this.key,`${command.appId}:${command.id}:${row.termsHash}`);
    if(sha256(canonicalJson({escrowId:command.escrowId,raw,...(command.replacesTransactionId?{replacesTransactionId:command.replacesTransactionId}:{})}))!==command.requestHash || keccak256(raw)!==command.transactionId)throw new Error('artifact_mismatch');
    return {raw,binding,row};
  }
  private async record(command: BaseLocalCommand, owner: string, evidence: Evidence) {
    return this.db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<{commandId:string}[]>`SELECT "commandId" FROM "BaseLocalDispatch" WHERE "commandId"=${command.id} AND "appId"=${command.appId} AND "leaseOwner"=${owner} AND "leaseUntil">now() FOR UPDATE`;
      if(!locked.length) throw new Error('lease_lost');
      const old=await tx.baseLocalDispatch.findUniqueOrThrow({where:{commandId:command.id}});
      if(old.status==='reconciliation_required' || (old.blockHash && old.blockHash!==evidence.blockHash) || (old.status==='finalized' && evidence.state!=='finalized')) evidence={...evidence,state:'reconciliation_required'};
      const hash=localEvidenceHash(evidence);
      if(old.lastEvidenceHash!==hash){
        const last=await tx.baseLocalCommandEvidence.findFirst({where:{commandId:command.id},orderBy:{sequence:'desc'}});
        await tx.baseLocalCommandEvidence.create({data:{id:randomUUID(),appId:command.appId,commandId:command.id,sequence:(last?.sequence??0)+1,evidenceJson:canonicalJson(evidence)}});
        const escrow=await tx.baseLocalEscrow.findUniqueOrThrow({where:{id:command.escrowId}});
        await createEvent(tenantContext(command.appId),{type:`base.local.operation.${evidence.state}`,agreementId:escrow.agreementId,milestoneId:escrow.milestoneId,
          payload:{operationId:command.id,transactionId:command.transactionId,localOnly:true,...evidence}},tx);
      }
      await tx.baseLocalDispatch.update({where:{commandId:command.id},data:{status:evidence.state,blockHash:evidence.blockHash,blockNumber:evidence.blockNumber,lastEvidenceHash:hash,
        leaseOwner:null,leaseUntil:null,availableAt:new Date(Date.now()+5000)}});
      return evidence;
    });
  }
  // A bounded oldest-available scan includes finalized history forever. No in-memory
  // head is authoritative; restart resumes pending leases and historical corrections.
  async tick(owner: string, options: { afterSend?:()=>Promise<void>; appId?:string } = {}) {
    await this.evm.assertLocal();
    const claimed=await this.db.$queryRaw<{commandId:string}[]>`
      WITH candidate AS (SELECT "commandId" FROM "BaseLocalDispatch"
      WHERE (${options.appId??null}::text IS NULL OR "appId"=${options.appId??null}::text) AND "availableAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<=now())
      ORDER BY "availableAt", "commandId" FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE "BaseLocalDispatch" d SET "leaseOwner"=${owner},"leaseUntil"=now()+interval '30 seconds',"attempts"=d."attempts"+1
      FROM candidate WHERE d."commandId"=candidate."commandId" RETURNING d."commandId"`;
    if(!claimed.length)return null;
    const command=await this.db.baseLocalCommand.findUniqueOrThrow({where:{id:claimed[0].commandId}});
    const prior=await this.db.baseLocalDispatch.findUniqueOrThrow({where:{commandId:command.id}});
    let recovered: Awaited<ReturnType<LocalLifecycle['recover']>>;
    try{recovered=await this.recover(command);}catch{return this.record(command,owner,{state:'reconciliation_required',blockHash:prior.blockHash,blockNumber:prior.blockNumber,reason:'artifact_or_identity_unverified'});}
    const {raw,binding}=recovered;
    let receipt;
    try { receipt=await this.evm.provider.send('eth_getTransactionReceipt',[command.transactionId]); }
    catch { return this.record(command,owner,{state:'unknown',blockHash:prior.blockHash,blockNumber:prior.blockNumber,reason:'provider_unavailable'}); }
    if(!receipt){
      if(prior.blockHash || prior.status==='finalized' || prior.status==='reconciliation_required')return this.record(command,owner,{state:'reconciliation_required',blockHash:null,blockNumber:null,reason:'historical_receipt_missing'});
      const nonce=BigInt(await this.evm.provider.send('eth_getTransactionCount',[command.sender,'latest']));
      if(nonce>BigInt(command.nonce))return this.record(command,owner,{state:'reconciliation_required',blockHash:null,blockNumber:null,reason:'nonce_consumed_without_receipt'});
      const scope=command.action==='funding'?0:command.action==='mutual'?1:command.action==='arbitration'?2:null;
      if(scope!==null) {
        const current=await this.evm.provider.send('eth_call',[{to:binding.instance,data:localAbi.encodeFunctionData('intentEpoch',[scope])},'latest']);
        if(localAbi.decodeFunctionResult('intentEpoch',current)[0]!==BigInt(command.epoch))return this.record(command,owner,{state:'reconciliation_required',blockHash:null,blockNumber:null,reason:'onchain_intent_epoch_changed'});
      }
      // Commit uncertainty BEFORE external IO. A crash recovers exactly the same signed bytes.
      await this.db.baseLocalDispatch.updateMany({where:{commandId:command.id,leaseOwner:owner},data:{status:'unknown'}});
      try {
        await verifyLocalTransaction(this.evm,binding,raw);
        const sent=await this.evm.sendRaw(raw);if(sent!==command.transactionId)throw new Error('wrong_transaction_hash');
      }catch{return this.record(command,owner,{state:'unknown',blockHash:null,blockNumber:null,reason:'submission_unconfirmed'});}
      await options.afterSend?.(); // failure injection models a process dying after RPC success
      receipt=await this.evm.provider.send('eth_getTransactionReceipt',[command.transactionId]);
    }
    let evidence: Evidence;
    try{evidence=await this.inspect(command,binding,raw,receipt);}catch{evidence={state:'reconciliation_required',blockHash:prior.blockHash,blockNumber:prior.blockNumber,reason:'receipt_unverified'};}
    return this.record(command,owner,evidence);
  }
  private async inspect(command: BaseLocalCommand, b: LocalDeployment, raw: string, receipt: any): Promise<Evidence> {
    if(!receipt)return {state:'unknown',blockHash:null,blockNumber:null,reason:'receipt_pending'};
    if(receipt.status!=='0x1' || receipt.transactionHash!==command.transactionId || receipt.to?.toLowerCase()!==b.instance.toLowerCase())throw new Error('receipt_failed');
    const tx=Transaction.from(raw), parsed=localAbi.parseTransaction({data:tx.data})!;
    const chainTx=await this.evm.provider.send('eth_getTransactionByHash',[command.transactionId]);
    if(!chainTx || chainTx.input!==tx.data || chainTx.from.toLowerCase()!==command.sender || BigInt(chainTx.value)!==0n)throw new Error('transaction_mismatch');
    const canonical=await this.evm.provider.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
    if(canonical?.hash!==receipt.blockHash)throw new Error('noncanonical');
    const at={blockHash:receipt.blockHash,requireCanonical:true};
    const code=await this.evm.provider.send('eth_getCode',[b.instance,at]);if(keccak256(code)!==b.codeHash)throw new Error('code_mismatch');
    const th=await this.evm.provider.send('eth_call',[{to:b.instance,data:localAbi.encodeFunctionData('termsHash')},at]);
    if(localAbi.decodeFunctionResult('termsHash',th)[0]!==termsHashFor(b))throw new Error('terms_mismatch');
    const expectedName=command.action==='funding'?'Funded':command.action==='dispute'?'DisputeInvoked':command.action.startsWith('cancel:')?'IntentCancelled':'Settled';
    const logs=receipt.logs.filter((l:any)=>l.address.toLowerCase()===b.instance.toLowerCase()).map((l:any)=>{try{return localAbi.parseLog(l);}catch{return null;}}).filter((l:any)=>l?.name===expectedName);
    if(logs.length!==1)throw new Error('event_mismatch');
    const a=logs[0].args,t=b.terms;
    if(expectedName==='Funded' && (a[0]!==t.escrowId || a[1]!==termsHashFor(b) || a[2]!==BigInt(t.principal)+BigInt(t.principal)*BigInt(t.clientBps)/10000n))throw new Error('funding_mismatch');
    if(expectedName==='DisputeInvoked' && (a[0]!==t.escrowId || a[1].toLowerCase()!==String(parsed.args[0]).toLowerCase()))throw new Error('dispute_mismatch');
    if(expectedName==='IntentCancelled' && (a[0]!==termsHashFor(b) || a[1]!==BigInt(command.action.slice(-1)) || a[2]!==BigInt(command.epoch) || a[3]!==BigInt(command.epoch)+1n))throw new Error('epoch_mismatch');
    if(expectedName==='Settled') {
      const w=command.action==='fallback'?t.fallbackWorker:parsed.args[0].toString();
      const rpc=(method:string,params:unknown[])=>this.evm.provider.send(method,params as any[]);
      const adapter=new LocalBaseAdapter(b,[{operator:'local-view-a',rpc},{operator:'local-view-b',rpc}]);
      const v=await adapter.observe(command.transactionId,w,command.action==='fallback'?2:command.action==='arbitration'?1:0);
      if(v.state!=='finalized' && v.state!=='included')throw new Error('settlement_unverified');
    }
    const finalized=await this.evm.provider.send('eth_getBlockByNumber',['finalized',false]);
    if(!finalized)throw new Error('missing_finalized');
    const fc=await this.evm.provider.send('eth_getBlockByNumber',[finalized.number,false]);
    const recheck=await this.evm.provider.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
    if(fc?.hash!==finalized.hash || recheck?.hash!==receipt.blockHash)throw new Error('changed_canonical');
    return {state:BigInt(finalized.number)>=BigInt(receipt.blockNumber)?'finalized':'included',blockHash:receipt.blockHash,blockNumber:BigInt(receipt.blockNumber).toString(),reason:'local_anvil_evidence_not_independent_finality'};
  }
}
import { termsHash } from './codec';
const termsHashFor=(b:LocalDeployment)=>termsHash(b.terms);
