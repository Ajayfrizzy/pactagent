import { Interface, Transaction, getAddress, recoverAddress, keccak256, toUtf8Bytes } from 'ethers';
import { authorizationDigest, cancellationDigest, termsHash, type Terms } from './codec';
import { LocalEvm } from './local-rpc';
// Exact function signatures are checked against compiled artifacts by integration tests.
export const localAbi = new Interface([
  'function termsHash() view returns(bytes32)', 'function intentEpoch(uint8) view returns(uint256)', 'function state() view returns(uint8)',
  'function fund(uint256,bytes,bytes)', 'function settleMutual(uint256,uint256,bytes,bytes)',
  'function invokeDispute(address,uint256,bytes)', 'function settleArbitral(uint256,uint256,bytes[])',
  'function settleFallback()', 'function cancelIntent(uint8,uint256,uint256,address,bytes[])',
  'event Funded(bytes32 indexed escrowId,bytes32 indexed termsHash,uint256 deposit)',
  'event DisputeInvoked(bytes32 indexed escrowId,address indexed participant)',
  'event IntentCancelled(bytes32 indexed termsHash,uint8 indexed action,uint256 oldEpoch,uint256 newEpoch)',
  'event Settled(bytes32 indexed escrowId,bytes32 indexed termsHash,uint8 indexed path,uint256 workerPrincipal,uint256 clientPrincipal,uint256 workerNet,uint256 clientNet,uint256 treasuryNet)',
]);
const walletAbi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
export type LocalDeployment = { instance: string; terms: Terms; codeHash: string };
export async function checkLocalBinding(evm: LocalEvm, b: LocalDeployment, at: string = 'latest') {
  await evm.assertLocal();
  const code = await evm.provider.send('eth_getCode', [b.instance, at]);
  if (code === '0x' || keccak256(code) !== b.codeHash) throw new Error('unverified_local_code');
  const result = await evm.provider.send('eth_call', [{to: b.instance, data: localAbi.encodeFunctionData('termsHash')}, at]);
  if (localAbi.decodeFunctionResult('termsHash', result)[0] !== termsHash(b.terms)) throw new Error('terms_mismatch');
}
async function participant(evm: LocalEvm, who: string, digest: string, signature: string) {
  const code = await evm.provider.send('eth_getCode', [who, 'latest']);
  if (code === '0x') {
    if (getAddress(recoverAddress(digest, signature)) !== getAddress(who)) throw new Error('consent_required');
  } else {
    const result = await evm.provider.send('eth_call', [{ to: who, data: walletAbi.encodeFunctionData('isValidSignature',[digest,signature]) }, 'latest']);
    if (walletAbi.decodeFunctionResult('isValidSignature', result)[0] !== '0x1626ba7e') throw new Error('consent_required');
  }
}
async function arbiters(evm: LocalEvm, t: Terms, digest: string, sigs: readonly string[]) {
  if (!sigs.length || sigs.length !== Number(t.threshold)) throw new Error('arbiter_threshold_required');
  let previous = '';
  for (const sig of sigs) {
    const signer = recoverAddress(digest,sig).toLowerCase();
    if (signer <= previous || !t.arbiters.map(s=>s.toLowerCase()).includes(signer)
      || await evm.provider.send('eth_getCode',[signer,'latest']) !== '0x') throw new Error('invalid_arbiter');
    previous = signer;
  }
}
export async function verifyLocalTransaction(evm: LocalEvm, b: LocalDeployment, raw: string) {
  if (!/^0x[0-9a-fA-F]+$/.test(raw) || raw.length > 262144) throw new Error('invalid_transaction');
  await checkLocalBinding(evm,b);
  const tx = Transaction.from(raw);
  if (!tx.isSigned() || tx.chainId !== 31337n || !tx.to || getAddress(tx.to) !== getAddress(b.instance) || tx.value !== 0n
    || tx.nonce > 2147483647 || tx.type !== 2 || tx.blobs || tx.authorizationList?.length || !tx.hash || !tx.from) throw new Error('invalid_transaction');
  const call = localAbi.parseTransaction({data:tx.data, value:tx.value});
  if (!call || localAbi.encodeFunctionData(call.fragment, call.args) !== tx.data) throw new Error('invalid_call');
  const t=b.terms;
  const epochAt = async (action: number) => {
    const r = await evm.provider.send('eth_call',[{to:b.instance,data:localAbi.encodeFunctionData('intentEpoch',[action])},'latest']);
    return localAbi.decodeFunctionResult('intentEpoch',r)[0].toString() as string;
  };
  let action: string, epoch='0';
  const digest = (kind: 'funding'|'mutual'|'dispute'|'arbitration', expiry: bigint, w?: bigint) => authorizationDigest({action:kind, terms:t, instance:b.instance, chainId:'31337', validUntil:expiry.toString(), epoch, ...(w===undefined?{}:{workerAmount:w.toString()})});
  if (call.name==='fund' || call.name==='settleMutual') {
    const funding=call.name==='fund';action=funding?'funding':'mutual';epoch=await epochAt(funding?0:1);
    const args=call.args, expiry=args[funding?0:1] as bigint;
    const d=digest(funding?'funding':'mutual',expiry,funding?undefined:args[0]);
    await participant(evm,t.client,d,args[funding?1:2]);await participant(evm,t.worker,d,args[funding?2:3]);
  } else if(call.name==='invokeDispute') {
    action='dispute';const who=String(call.args[0]);
    if (![t.client,t.worker].some(a=>getAddress(a)===getAddress(who))) throw new Error('invalid_participant');
    await participant(evm,who,digest('dispute',call.args[1]),call.args[2]);
  } else if(call.name==='settleArbitral') {
    action='arbitration';epoch=await epochAt(2);await arbiters(evm,t,digest('arbitration',call.args[1],call.args[0]),call.args[2]);
  } else if(call.name==='cancelIntent') {
    const n=Number(call.args[0]);if (![0,1,2].includes(n)) throw new Error('invalid_action');
    action=`cancel:${n}`;epoch=await epochAt(n);
    if(call.args[1].toString()!==epoch) throw new Error('stale_epoch');
    const d=cancellationDigest(t,b.instance,'31337',n as 0|1|2,epoch,call.args[2].toString());
    if(n===2) await arbiters(evm,t,d,call.args[4]);
    else {
      const who=String(call.args[3]);if(![t.client,t.worker].some(a=>getAddress(a)===getAddress(who)) || call.args[4].length!==1) throw new Error('invalid_participant');
      await participant(evm,who,d,call.args[4][0]);
    }
  } else if(call.name==='settleFallback') action='fallback';
  else throw new Error('unsupported_call');
  // Simulate complete contract logic; API verification is advisory, contract rechecks at execution.
  await evm.provider.send('eth_call',[{from:tx.from,to:tx.to,data:tx.data,value:'0x0'},'latest']);
  return { action,epoch,transactionId:tx.hash, sender:tx.from.toLowerCase(), nonce:tx.nonce, raw, call };
}
export const localEvidenceHash = (v: unknown) => keccak256(toUtf8Bytes(JSON.stringify(v)));
