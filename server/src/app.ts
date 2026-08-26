import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler } from './common/middleware/error-handler';
import { requestContext } from './common/middleware/request-context';
import { v1IpRateLimit } from './common/rate-limit/infrastructure-rate-limit';
import appRoutes from './modules/apps/app.routes';
import apiKeyRoutes from './modules/api-keys/api-key.routes';
import auditLogRoutes from './modules/audit-logs/audit-log.routes';
import infrastructureAgreementRoutes from './modules/agreements/agreement.routes';
import infrastructureMilestoneRoutes from './modules/milestones/milestone.routes';
import eventRoutes from './modules/events/event.routes';
import escrowRoutes from './modules/escrows/escrow.routes';
import transactionRoutes from './modules/transactions/transaction.routes';
import proofRoutes from './modules/proofs/proof.routes';
import reviewRoutes from './modules/reviews/review.routes';
import disputeRoutes from './modules/disputes/dispute.routes';
import webhookEndpointRoutes, { webhookDeliveryRoutes } from './modules/webhooks/webhook.routes';
import adminRoutes from './modules/admin/admin.routes';
import healthRoutes from './modules/health/health.routes';
import docsRoutes from './modules/docs/docs.routes';
import authRoutes from './modules/auth/auth.routes';
import { metricsMiddleware } from './common/observability/metrics';
import { requestLogger } from './common/observability/request-logger';
import { payloadLimit } from './common/middleware/payload-limit';

function isAllowedCorsOrigin(origin: string) {
  if (config.corsOrigins.includes(origin)) {
    return true;
  }

  if (!config.allowLocalhostCors) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname)
      && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestContext);
  app.use(metricsMiddleware);
  app.use(requestLogger);
  app.use(helmet({
    crossOriginResourcePolicy: false,
  }));
  app.use(
    cors({
      origin(origin, callback) {
        // Allow curl, server-to-server calls, and configured browser origins.
        if (!origin || isAllowedCorsOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/v1', v1IpRateLimit);

  app.use('/v1/apps', payloadLimit(64 * 1024));
  app.use('/v1/auth', payloadLimit(16 * 1024));
  app.use('/v1/api-keys', payloadLimit(64 * 1024));
  app.use('/v1/agreements', payloadLimit(256 * 1024));
  app.use('/v1/milestones', payloadLimit(128 * 1024));
  app.use('/v1/proofs', payloadLimit(1024 * 1024));
  app.use('/v1/webhook-endpoints', payloadLimit(64 * 1024));
  app.use('/v1/disputes', payloadLimit(256 * 1024));
  app.use('/v1/escrows', payloadLimit(64 * 1024));
  app.use('/v1/reviews', payloadLimit(128 * 1024));
  app.use('/v1/admin', payloadLimit(64 * 1024));
  app.use('/v1', payloadLimit(256 * 1024));

  app.use('/v1/auth', authRoutes);
  app.use('/v1/apps', appRoutes);
  app.use('/v1/api-keys', apiKeyRoutes);
  app.use('/v1/agreements', infrastructureAgreementRoutes);
  app.use('/v1/milestones', infrastructureMilestoneRoutes);
  app.use('/v1/escrows', escrowRoutes);
  app.use('/v1/transactions', transactionRoutes);
  app.use('/v1/proofs', proofRoutes);
  app.use('/v1/reviews', reviewRoutes);
  app.use('/v1/disputes', disputeRoutes);
  app.use('/v1/events', eventRoutes);
  app.use('/v1/webhook-endpoints', webhookEndpointRoutes);
  app.use('/v1/webhook-deliveries', webhookDeliveryRoutes);
  app.use('/v1/audit-logs', auditLogRoutes);
  app.use('/v1/admin', adminRoutes);
  app.use(healthRoutes);
  app.use(docsRoutes);

  app.use('/api', (_req, res) => {
    res.status(410).json({
      success: false,
      error: 'Legacy product API routes were removed. Use the app-scoped /v1 infrastructure API.',
    });
  });

  app.use(errorHandler);

  return app;
}
