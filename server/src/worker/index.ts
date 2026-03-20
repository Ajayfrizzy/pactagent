import { config } from '../config';
import { runAgentCycle } from './agentLoop';
import { createLog } from '../services/logService';

/**
 * Standalone agent worker process.
 * Runs the agent loop on a configurable interval.
 * Can be started separately: npm run worker
 */
let agentTimer: NodeJS.Timeout | null = null;

function scheduleNextCycle() {
  agentTimer = setTimeout(async () => {
    try {
      await runAgentCycle();
    } finally {
      scheduleNextCycle();
    }
  }, config.agentIntervalMs);
}

async function main() {
  console.log(`[AGENT] PactAgent Worker starting...`);
  console.log(`[AGENT] Cycle interval: ${config.agentIntervalMs}ms`);
  console.log(`[AGENT] Fiber enabled: ${config.fiberEnabled}`);
  console.log(`[AGENT] AI enabled: ${config.aiEnabled}`);

  await createLog({
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: 'PactAgent Worker started — observing agreements...',
    metadata: { intervalMs: config.agentIntervalMs, fiberEnabled: config.fiberEnabled },
  });

  // Run first cycle immediately
  await runAgentCycle();

  // Then run on interval
  scheduleNextCycle();
}

main().catch((err) => {
  console.error('[AGENT] Fatal error:', err);
  process.exit(1);
});
