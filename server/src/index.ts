import cors from 'cors';
import express from 'express';
import http from 'http';
import { config } from './config';
import agreementRoutes from './routes/agreements';
import authRoutes from './routes/auth';
import fiberRoutes from './routes/fiber';
import inviteRoutes from './routes/invites';
import integrationRoutes from './routes/integrations';
import logRoutes from './routes/logs';
import meRoutes from './routes/me';
import profileRoutes from './routes/profiles';
import webhookRoutes from './routes/webhooks';
import { createLog } from './services/logService';
import { checkFiberHealth } from './services/fiberService';
import { getTreasuryAddress } from './services/ckbService';
import { isOnchainEscrowReady } from './services/onchainEscrowService';
import { initWebSocket } from './ws';
import { runAgentCycle } from './worker/agentLoop';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Allow curl, server-to-server calls, and configured browser origins.
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  })
);
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/fiber', fiberRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.get('/api/config', async (_req, res) => {
  const fiberHealthy = await checkFiberHealth();
  const treasuryAddress = await getTreasuryAddress().catch(() => null);
  const forumPublishReady =
    config.forumPublishEnabled
    && (
      (config.forumPublishProvider === 'DISCOURSE'
        && Boolean(config.forumPublishApiKey)
        && Boolean(config.forumPublishApiUsername))
      || (config.forumPublishProvider === 'WEBHOOK'
        && Boolean(config.forumPublishWebhookUrl))
    );

  res.json({
    success: true,
    data: {
      ckbNodeUrl: config.ckbNodeUrl,
      ckbNetwork: config.ckbNetwork,
      fiberEnabled: config.fiberEnabled,
      fiberHealthy,
      aiEnabled: config.aiEnabled,
      agentIntervalMs: config.agentIntervalMs,
      forumPublishEnabled: config.forumPublishEnabled,
      forumPublishProvider: config.forumPublishProvider,
      forumPublishReady,
      ckboostSyncEnabled: config.ckboostSyncEnabled,
      ckboostWebhookConfigured: Boolean(config.ckboostWebhookUrl),
      treasuryAddress,
      onchainEscrowEnabled: config.onchainEscrowEnabled,
      onchainEscrowReady: isOnchainEscrowReady(),
      supportedEscrowModels: isOnchainEscrowReady()
        ? ['TREASURY_BRIDGE', 'ONCHAIN_LOCK']
        : ['TREASURY_BRIDGE'],
      onchainLockTxHash: config.onchainLockTxHash || null,
      onchainLockIndex: config.onchainLockIndex || null,
      onchainLockDepType: config.onchainLockDepType || null,
    },
  });
});

const server = http.createServer(app);
initWebSocket(server);

let agentTimer: NodeJS.Timeout | null = null;

function scheduleNextAgentCycle() {
  agentTimer = setTimeout(async () => {
    try {
      await runAgentCycle();
    } finally {
      scheduleNextAgentCycle();
    }
  }, config.agentIntervalMs);
}

async function startAgent() {
  console.log(`[AGENT] Starting embedded agent watcher (interval: ${config.agentIntervalMs}ms)`);

  await createLog({
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: 'PactAgent server started and the agent watcher is active',
    metadata: { intervalMs: config.agentIntervalMs },
  });

  await runAgentCycle();

  scheduleNextAgentCycle();
}

server.listen(config.port, () => {
  console.log(`[SERVER] PactAgent API running on http://localhost:${config.port}`);
  console.log(`[SERVER] WebSocket on ws://localhost:${config.port}/ws`);
  console.log(`[SERVER] CKB Network: ${config.ckbNetwork}`);
  console.log(`[SERVER] Fiber enabled: ${config.fiberEnabled}`);
  console.log(`[SERVER] AI enabled: ${config.aiEnabled}`);

  startAgent().catch(console.error);
});
