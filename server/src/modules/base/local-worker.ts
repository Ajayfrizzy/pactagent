import { randomUUID } from 'node:crypto';
import type { LocalLifecycle } from './local-lifecycle';
// Explicit local harness dependency only. Never registered with production workers.
export async function runLocalWorker(service: LocalLifecycle, signal: AbortSignal, intervalMs=1000) {
  if(intervalMs<100 || intervalMs>60000)throw new Error('invalid_poll_interval');
  const owner=`local-base:${randomUUID()}`;
  while(!signal.aborted) {
    try { await service.tick(owner); } catch { /* retain lease/evidence; next poll recovers, no new signing */ }
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,intervalMs);signal.addEventListener('abort',done,{once:true});
      if(signal.aborted)done();
    });
  }
}
