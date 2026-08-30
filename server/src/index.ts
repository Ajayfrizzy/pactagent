import './common/observability/tracing';
import http from 'http';
import { createApp } from './app';
import { config, validateProductionConfig } from './config';
import { requireDatabaseUrl } from './db';
import { prisma } from './db';
import { beginShutdown } from './common/runtime/lifecycle';
import { installConsoleBridge, log } from './common/observability/logger';
import { shutdownTracing } from './common/observability/tracing';
import { closeRateLimitStore } from './common/rate-limit/infrastructure-rate-limit';
import { assertRequiredMigrationsApplied } from './common/migrations/migration-readiness';
import { closeAuthChallengeStore } from './services/authChallengeStore';

validateProductionConfig();
requireDatabaseUrl();
installConsoleBridge();

const app = createApp();
const server = http.createServer(app);

assertRequiredMigrationsApplied()
  .then(() => server.listen(config.port, () => {
    log('info', 'server.started', {
      port: config.port,
      ckbNetwork: config.ckbNetwork,
      version: config.buildVersion,
      commit: config.buildCommit,
    });
  }))
  .catch((error) => {
    log('error', 'server.migrations.not_ready', { error });
    void prisma.$disconnect().finally(() => { process.exitCode = 1; });
  });

let shutdownPromise: Promise<void> | null = null;
function shutdown(signal: string) {
  if (shutdownPromise) return shutdownPromise;
  beginShutdown();
  shutdownPromise = (async () => {
    log('info', 'server.shutdown.started', { signal });
    const timeout = setTimeout(() => {
      log('error', 'server.shutdown.timeout', { timeoutMs: config.shutdownTimeoutMs });
      server.closeAllConnections();
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timeout.unref();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
    await closeRateLimitStore();
    await closeAuthChallengeStore();
    await shutdownTracing();
    clearTimeout(timeout);
    log('info', 'server.shutdown.completed');
  })().catch((error) => {
    log('error', 'server.shutdown.failed', { error });
    process.exitCode = 1;
  });
  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
