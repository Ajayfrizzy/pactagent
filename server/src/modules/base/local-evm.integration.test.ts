import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { Wallet, Interface, keccak256 } from 'ethers';
import { prisma } from '../../db';
import { config } from '../../config';
import { encryptWebhookSecret, generateWebhookSecret, hashWebhookSecret } from '../webhooks/webhook.signing';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { getApiKeyPrefix, hashApiKey } from '../../common/crypto/api-keys';
import { errorHandler } from '../../common/middleware/error-handler';
import { localTerms, wordId } from './fixtures';
import { sha256 } from './artifacts';
import { LocalEvm } from './local-rpc';
import { LocalLifecycle } from './local-lifecycle';
import { localAbi } from './local-consent';
import { localFinancialRouter } from './local-api';
import { authorizationDigest, cancellationDigest } from './codec';
const enabled=process.env.RUN_LOCAL_EVM_TESTS==='true';
const options={skip:!enabled,timeout:120000};
after(()=>prisma.$disconnect());
const artifact=(name:string)=>JSON.parse(readFileSync(resolve(__dirname,`../../../../contracts/evm/out/PactEscrow.t.sol/${name}.json`),'utf8'));

test('local EVM API → cryptographic consent → durable outbox → restart → cancellation/replacement → finalized history → reorg correction',options,async()=>{
  const port=Number(process.env.LOCAL_EVM_PORT ?? 18545), evm=new LocalEvm(port);
  await evm.assertLocal();
  const client=Wallet.createRandom(),worker=Wallet.createRandom(),relayer=Wallet.createRandom();
  const arbiter=Wallet.createRandom();
  for(const wallet of [client,worker,relayer])await evm.provider.send('anvil_setBalance',[wallet.address,'0x3635c9adc5dea00000']);
  const token=`0x${randomBytes(20).toString('hex')}`,instance=`0x${randomBytes(20).toString('hex')}`;
  // Install local VM fixtures without deploying contracts or broadcasting creation txs.
  // Constructor is evaluated by eth_call only; returned immutable-bearing runtime is installed via Anvil cheat RPC.
  const tokenArtifact=artifact('MockUSDC'),escrowArtifact=artifact('CloneEscrowCandidate');
  await evm.provider.send('anvil_setCode',[token,tokenArtifact.deployedBytecode.object]);
  const runtime=await evm.provider.send('eth_call',[{from:relayer.address,data:escrowArtifact.bytecode.object},'latest']);
  await evm.provider.send('anvil_setCode',[instance,runtime]);
  const app=await prisma.app.create({data:{name:'M2 EVM harness',slug:randomUUID(),ownerId:'local-test'}});
  const tenant=tenantContext(app.id);
  config.webhookActiveKeyId='local-evm';config.webhookEncryptionKeys['local-evm']=randomBytes(32).toString('hex');
  const webhookSecret=generateWebhookSecret();
  const endpoint=await prisma.webhookEndpoint.create({data:{appId:app.id,secretHash:hashWebhookSecret(webhookSecret),secretCiphertext:encryptWebhookSecret(webhookSecret),encryptionKeyVersion:'local-evm',url:'http://127.0.0.1:9/local-fixture',subscribedEvents:['base.local.operation.queued','base.local.operation.finalized','base.local.operation.reconciliation_required']}});
  const agreement=await prisma.agreement.create({data:{appId:app.id,title:'local EVM',description:'',amount:'4000004',currency:'TEST',deadlineAt:new Date()}});
  const milestone=await prisma.milestone.create({data:{appId:app.id,agreementId:agreement.id,title:'local',description:'',amount:'1000001',currency:'TEST',sortOrder:0}});
  const head=await evm.provider.send('eth_getBlockByNumber',['latest',false]);const now=Number(BigInt(head.timestamp));
  const t={...localTerms(),appId:`0x${sha256(app.id)}`,agreementId:`0x${sha256(agreement.id)}`,milestoneId:`0x${sha256(milestone.id)}`,
    token,client:client.address,worker:worker.address,treasury:Wallet.createRandom().address,arbiters:[arbiter.address],threshold:'1',disputeDeadline:String(now+3600),finalDeadline:String(now+7200),minDisputeInterval:'60'};
  const {arbiters,...tuple}=t;
  const rawFor=async(w:Wallet|ReturnType<typeof Wallet.createRandom>,to:string,data:string)=>w.signTransaction({type:2,chainId:31337,to,data,value:0n,
    nonce:Number(BigInt(await evm.provider.send('eth_getTransactionCount',[w.address,'pending']))),gasLimit:5000000n,maxFeePerGas:3000000000n,maxPriorityFeePerGas:1000000000n});
  const direct=async(w:Wallet|ReturnType<typeof Wallet.createRandom>,to:string,data:string)=>evm.sendRaw(await rawFor(w,to,data));
  await direct(relayer,instance,new Interface(escrowArtifact.abi).encodeFunctionData('initialize',[tuple,arbiters]));
  const tokenAbi=new Interface(tokenArtifact.abi);
  await direct(relayer,token,tokenAbi.encodeFunctionData('mint',[client.address,1100001]));
  await direct(client,token,tokenAbi.encodeFunctionData('approve',[instance,1100001]));
  const key={version:'local-test-1',bytes:randomBytes(32)};
  let service=new LocalLifecycle(prisma,evm,key,new Set([keccak256(runtime)]));
  const tick=(owner:string,options:{afterSend?:()=>Promise<void>}={})=>service.tick(owner,{...options,appId:app.id});
  const finalize=async(id:string)=>{await evm.provider.send('anvil_mine',['0x40']);await prisma.baseLocalDispatch.update({where:{commandId:id},data:{availableAt:new Date(0)}});return tick('finality-sweep');};
  const keys=[`pa_test_${randomUUID()}`,`pa_test_${randomUUID()}`,`pa_test_${randomUUID()}`];
  const other=await prisma.app.create({data:{name:'other local',slug:randomUUID(),ownerId:'local-test'}});
  for(const [i,scopes] of [['escrows:v2:read','escrows:v2:propose'],['escrows:v2:read'],['escrows:v2:read','escrows:v2:propose']].entries()) {
    await prisma.apiKey.create({data:{appId:i===2?other.id:app.id,name:'test',environment:'sandbox',keyPrefix:getApiKeyPrefix(keys[i]),keyHash:hashApiKey(keys[i]),scopes}});
  }
  const api=express();api.use(express.json({limit:'150kb'}));api.use('/v2/local/base',localFinancialRouter(service));api.use(errorHandler);
  const server=api.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr && typeof addr!=='string');
  const request=async(path:string,body?:unknown,key=keys[0])=>fetch(`http://127.0.0.1:${addr.port}/v2/local/base${path}`,{method:body===undefined?'GET':'POST',headers:{'x-api-key':key,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try {
    let response=await request('/escrows',{agreementId:agreement.id,milestoneId:milestone.id,instance,terms:t});assert.equal(response.status,201);
    const escrowId=(await response.json() as any).data.id;
    response=await request(`/escrows/${escrowId}/signing-payload`,{action:'funding',validUntil:String(now+1800)},keys[2]);assert.equal(response.status,404);
    response=await request(`/escrows/${escrowId}/signing-payload`,{action:'funding',validUntil:String(now+1800)});assert.equal(response.status,200);
    const payload=(await response.json() as any).data;
    const clientSig=client.signingKey.sign(payload.digest).serialized,workerSig=worker.signingKey.sign(payload.digest).serialized;
    const wrongChain=await relayer.signTransaction({type:2,chainId:84532,to:instance,data:localAbi.encodeFunctionData('fund',[now+1800,clientSig,workerSig]),nonce:99,gasLimit:500000,maxFeePerGas:3000000000n,maxPriorityFeePerGas:1000000000n});
    response=await request(`/escrows/${escrowId}/proposals`,{idempotencyKey:'wrong-chain',signedTransaction:wrongChain});assert.equal(response.status,409);
    const funding=await rawFor(relayer,instance,localAbi.encodeFunctionData('fund',[now+1800,clientSig,workerSig]));
    response=await request(`/escrows/${escrowId}/proposals`,{idempotencyKey:'fund',signedTransaction:funding},keys[1]);assert.equal(response.status,403);
    const wrong=await rawFor(relayer,instance,localAbi.encodeFunctionData('fund',[now+1800,clientSig,clientSig]));
    response=await request(`/escrows/${escrowId}/proposals`,{idempotencyKey:'bad',signedTransaction:wrong});assert.equal(response.status,409);
    const concurrent=await Promise.all([1,2].map(()=>request(`/escrows/${escrowId}/proposals`,{idempotencyKey:'fund',signedTransaction:funding})));
    assert.deepEqual(concurrent.map(r=>r.status),[202,202]);
    const fundId=(await concurrent[0].json() as any).data.id;assert.equal((await concurrent[1].json() as any).data.id,fundId);
    assert.equal(await prisma.baseLocalCommand.count({where:{appId:app.id}}),1);
    assert.equal(await prisma.event.count({where:{appId:app.id,type:'base.local.operation.queued'}}),1);
    assert.equal(await prisma.webhookDelivery.count({where:{appId:app.id,endpointId:endpoint.id,eventType:'base.local.operation.queued'}}),1);
    assert.equal(await prisma.agentJob.count({where:{appId:app.id,kind:'DELIVER_WEBHOOK'}}),1);
    response=await request(`/escrows/${escrowId}/proposals`,{idempotencyKey:'fund',signedTransaction:wrong});assert.equal(response.status,409);
    response=await request(`/operations/${fundId}`,undefined,keys[2]);assert.equal(response.status,404);
    // Simulated process death after accepted broadcast, before recording receipt.
    await assert.rejects(tick('crashed-worker',{afterSend:async()=>{throw new Error('simulated_crash');}}));
    const before=await evm.provider.send('eth_getTransactionCount',[relayer.address,'latest']);
    await prisma.baseLocalDispatch.update({where:{commandId:fundId},data:{leaseUntil:new Date(0)}});
    service=new LocalLifecycle(prisma,evm,key,new Set([keccak256(runtime)]));
    await tick('restart-worker');await finalize(fundId);assert.equal(await evm.provider.send('eth_getTransactionCount',[relayer.address,'latest']),before);
    assert.equal((await service.status(tenant,fundId)).status,'finalized');
    // Hold old mutual signatures, cancel onchain, prove stale signatures rejected.
    const expiry=String(now+7000);
    const oldDigest=authorizationDigest({action:'mutual',terms:t,instance,chainId:'31337',validUntil:expiry,workerAmount:'370001',epoch:'0'});
    const oldSigs=[client.signingKey.sign(oldDigest).serialized,worker.signingKey.sign(oldDigest).serialized];
    const oldRaw=await rawFor(relayer,instance,localAbi.encodeFunctionData('settleMutual',[370001,expiry,...oldSigs]));
    const oldCommand=await service.propose(tenant,escrowId,'old-mutual',oldRaw);
    await prisma.baseLocalDispatch.update({where:{commandId:oldCommand.id},data:{availableAt:new Date(Date.now()+86400000)}});
    const cancelDigest=cancellationDigest(t,instance,'31337',1,'0',expiry);
    const cancellation=await rawFor(client,instance,localAbi.encodeFunctionData('cancelIntent',[1,0,expiry,client.address,[client.signingKey.sign(cancelDigest).serialized]]));
    const cancel=await service.propose(tenant,escrowId,'cancel',cancellation);
    const realSend=evm.sendRaw.bind(evm);
    evm.sendRaw=async(raw:string)=>{await realSend(raw);throw new Error('simulated_lost_rpc_response');};
    await tick('cancel-worker');evm.sendRaw=realSend;
    assert.equal((await service.status(tenant,cancel.id)).status,'unknown');
    await finalize(cancel.id);
    assert.equal((await service.status(tenant,cancel.id)).status,'finalized');
    const stale=await rawFor(relayer,instance,localAbi.encodeFunctionData('settleMutual',[370001,expiry,...oldSigs]));
    await assert.rejects(service.propose(tenant,escrowId,'stale',stale));
    const fresh=await service.signingPayload(tenant,escrowId,'mutual',expiry,'370001');assert.equal(fresh.epoch,'1');
    const raw=await rawFor(relayer,instance,localAbi.encodeFunctionData('settleMutual',[370001,expiry,client.signingKey.sign(fresh.digest).serialized,worker.signingKey.sign(fresh.digest).serialized]));
    const snapshot=await evm.provider.send('evm_snapshot',[]);
    await assert.rejects(service.propose(tenant,escrowId,'unlinked',raw));
    const settlement=await service.propose(tenant,escrowId,'settle',raw,oldCommand.transactionId);
    await Promise.all([tick('worker-a'),tick('worker-b')]);await finalize(settlement.id);
    assert.equal((await service.status(tenant,settlement.id)).status,'finalized');
    const balance=async(a:string)=>BigInt(await evm.provider.send('eth_call',[{to:token,data:tokenAbi.encodeFunctionData('balanceOf',[a])},'latest']));
    assert.equal(await balance(worker.address),357680n);assert.equal(await balance(t.treasury),49321n);assert.equal(await balance(instance),0n);
    // Duplicated history does not create duplicated finalized notifications.
    await prisma.baseLocalDispatch.update({where:{commandId:settlement.id},data:{availableAt:new Date(0)}});await tick('sweep');
    assert.equal(await prisma.event.count({where:{appId:app.id,type:'base.local.operation.finalized',payloadJson:{contains:settlement.id}}}),1);
    await evm.provider.send('evm_revert',[snapshot]);
    await prisma.baseLocalDispatch.update({where:{commandId:settlement.id},data:{availableAt:new Date(0)}});await tick('reorg-sweep');
    assert.equal((await service.status(tenant,settlement.id)).status,'reconciliation_required');
    assert.equal(await balance(worker.address),0n);
    // Reappearance does not clear correction or create a second operation/payout.
    await evm.sendRaw(raw);await prisma.baseLocalDispatch.update({where:{commandId:settlement.id},data:{availableAt:new Date(0)}});await tick('historical-sweep');
    assert.equal((await service.status(tenant,settlement.id)).status,'reconciliation_required');
    assert.equal(await prisma.baseLocalCommand.count({where:{appId:app.id,action:'mutual'}}),2);
    await prisma.baseLocalDispatch.update({where:{commandId:oldCommand.id},data:{availableAt:new Date(0)}});await tick('cancelled-history');
    assert.equal((await service.status(tenant,oldCommand.id)).status,'reconciliation_required');
    assert.equal(await prisma.webhookDelivery.count({where:{appId:app.id,eventType:'base.local.operation.reconciliation_required'}})>0,true);
    await assert.rejects(prisma.baseLocalCommand.update({where:{id:settlement.id},data:{epoch:'99'}}));
    await assert.rejects(prisma.baseLocalCommand.delete({where:{id:fundId}}));
    await assert.rejects(prisma.baseLocalCommandEvidence.create({data:{id:randomUUID(),appId:other.id,commandId:fundId,sequence:999,evidenceJson:'{}'}}));
    await assert.rejects(prisma.baseLocalDispatch.update({where:{commandId:fundId},data:{appId:other.id}}));
    const lease=await prisma.baseLocalDispatch.findUniqueOrThrow({where:{commandId:settlement.id}});assert.equal(lease.leaseOwner,null);
    // Exercise the other financial branches through the same authenticated API,
    // persistent outbox and real local receipt verifier, not only contract mocks.
    for (const [index,mode] of ['refund','arbitration','fallback'].entries()) {
      const m=await prisma.milestone.create({data:{appId:app.id,agreementId:agreement.id,title:mode,description:'',amount:'1000001',currency:'TEST',sortOrder:index+1}});
      const address=`0x${randomBytes(20).toString('hex')}`;
      await evm.provider.send('anvil_setCode',[address,runtime]);
      const block=await evm.provider.send('eth_getBlockByNumber',['latest',false]);const time=Number(BigInt(block.timestamp));
      const terms={...t,escrowId:wordId(20+index),milestoneId:`0x${sha256(m.id)}`,disputeDeadline:String(time+3600),finalDeadline:String(time+7200)};
      const {arbiters:signers,...values}=terms;
      await direct(relayer,address,new Interface(escrowArtifact.abi).encodeFunctionData('initialize',[values,signers]));
      await direct(relayer,token,tokenAbi.encodeFunctionData('mint',[client.address,1100001]));
      await direct(client,token,tokenAbi.encodeFunctionData('approve',[address,1100001]));
      const created=await request('/escrows',{agreementId:agreement.id,milestoneId:m.id,instance:address,terms});assert.equal(created.status,201);
      const id=(await created.json() as any).data.id;
      const submit=async(data:string,key:string)=>{
        const response=await request(`/escrows/${id}/proposals`,{idempotencyKey:`${mode}:${key}`,signedTransaction:await rawFor(relayer,address,data)});
        assert.equal(response.status,202);const op=(await response.json() as any).data;
        await prisma.baseLocalDispatch.updateMany({where:{appId:app.id,commandId:{not:op.id}},data:{availableAt:new Date(Date.now()+86400000)}});
        await tick(`${mode}-worker`);await finalize(op.id);assert.equal((await service.status(tenant,op.id)).status,'finalized');return op;
      };
      const funding=await service.signingPayload(tenant,id,'funding',String(time+1800));
      await submit(localAbi.encodeFunctionData('fund',[time+1800,client.signingKey.sign(funding.digest).serialized,worker.signingKey.sign(funding.digest).serialized]),'fund');
      if(mode==='refund') {
        const intent=await service.signingPayload(tenant,id,'mutual',String(time+7000),'0');
        await submit(localAbi.encodeFunctionData('settleMutual',[0,time+7000,client.signingKey.sign(intent.digest).serialized,worker.signingKey.sign(intent.digest).serialized]),'refund');
      } else if(mode==='arbitration') {
        const dispute=await service.signingPayload(tenant,id,'dispute',String(time+3500));
        await submit(localAbi.encodeFunctionData('invokeDispute',[worker.address,time+3500,worker.signingKey.sign(dispute.digest).serialized]),'dispute');
        const intent=await service.signingPayload(tenant,id,'arbitration',String(time+7000),'370001');
        await submit(localAbi.encodeFunctionData('settleArbitral',[370001,time+7000,[arbiter.signingKey.sign(intent.digest).serialized]]),'arbitrate');
      } else {
        await evm.provider.send('evm_setNextBlockTimestamp',[time+7200]);await evm.provider.send('evm_mine',[]);
        await submit(localAbi.encodeFunctionData('settleFallback'),'fallback');
      }
      assert.equal(BigInt(await evm.provider.send('eth_call',[{to:token,data:tokenAbi.encodeFunctionData('balanceOf',[address])},'latest'])),0n);
    }
  } finally {
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));evm.close();
    // Preserve immutable financial evidence, but do not leave this fixture's
    // delivery jobs available to unrelated worker integration tests on reruns.
    await prisma.agentJob.deleteMany({where:{appId:{in:[app.id,other.id]}}});
  }
});
