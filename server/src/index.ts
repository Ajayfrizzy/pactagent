import cors from 'cors';
import express from 'express';
import http from 'http';
import { config } from './config';
import agreementRoutes from './routes/agreements';
import authRoutes from './routes/auth';
import fiberRoutes from './routes/fiber';
import logRoutes from './routes/logs';
import { createLog } from './services/logService';
import { checkFiberHealth } from './services/fiberService';
import { getTreasuryAddress } from './services/ckbService';
import { initWebSocket } from './ws';
import { runAgentCycle } from './worker/agentLoop';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/fiber', fiberRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.get('/api/config', async (_req, res) => {
  const fiberHealthy = await checkFiberHealth();
  const treasuryAddress = await getTreasuryAddress().catch(() => null);

  res.json({
    success: true,
    data: {
      ckbNodeUrl: config.ckbNodeUrl,
      ckbNetwork: config.ckbNetwork,
      fiberEnabled: config.fiberEnabled,
      fiberHealthy,
      aiEnabled: config.aiEnabled,
      agentIntervalMs: config.agentIntervalMs,
      treasuryAddress,
    },
  });
});

const server = http.createServer(app);
initWebSocket(server);

let agentInterval: NodeJS.Timeout | null = null;

async function startAgent() {
  console.log(`[AGENT] Starting embedded agent watcher (interval: ${config.agentIntervalMs}ms)`);

  await createLog({
    level: 'INFO',
    eventType: 'AGREEMENT_CREATED',
    message: 'PactAgent server started and the agent watcher is active',
    metadata: { intervalMs: config.agentIntervalMs },
  });

  await runAgentCycle();

  agentInterval = setInterval(async () => {
    await runAgentCycle();
  }, config.agentIntervalMs);
}

server.listen(config.port, () => {
  console.log(`[SERVER] PactAgent API running on http://localhost:${config.port}`);
  console.log(`[SERVER] WebSocket on ws://localhost:${config.port}/ws`);
  console.log(`[SERVER] CKB Network: ${config.ckbNetwork}`);
  console.log(`[SERVER] Fiber enabled: ${config.fiberEnabled}`);
  console.log(`[SERVER] AI enabled: ${config.aiEnabled}`);

  startAgent().catch(console.error);
});
