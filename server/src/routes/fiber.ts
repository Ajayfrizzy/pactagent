import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAdmin } from '../middleware/admin';
import { requireAuth } from '../middleware/auth';
import { createRateLimit } from '../middleware/rateLimit';
import { createAuditLog } from '../services/auditLogService';
import {
  getNodeInfo,
  checkFiberHealth,
  listChannels,
  openChannel,
  closeChannel,
  connectPeer,
  disconnectPeer,
  generateInvoice,
  payInvoice,
  getPaymentStatus,
} from '../services/fiberService';

const router = Router();
const fiberRateLimit = createRateLimit({
  namespace: 'fiber-admin',
  windowMs: config.actionRateLimitWindowMs,
  max: config.actionRateLimitMax,
});

router.use(requireAuth, requireAdmin, fiberRateLimit);

// ─── Node Info & Health ───

/**
 * GET /api/fiber/info
 * Returns Fiber node info (public key, channels, peers, version, etc.)
 */
router.get('/info', async (_req, res) => {
  try {
    if (!config.fiberEnabled) {
      return res.json({ success: false, error: 'Fiber is not enabled' });
    }

    const info = await getNodeInfo();
    if (!info) {
      return res.json({ success: false, error: 'Fiber node unreachable' });
    }

    res.json({ success: true, data: info });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/fiber/health
 * Quick health check — returns { healthy: true/false }
 */
router.get('/health', async (_req, res) => {
  try {
    const healthy = await checkFiberHealth();
    res.json({ success: true, data: { healthy, enabled: config.fiberEnabled } });
  } catch (error) {
    res.json({ success: true, data: { healthy: false, enabled: config.fiberEnabled } });
  }
});

// ─── Channel Management ───

/**
 * GET /api/fiber/channels
 * List all payment channels. Optional query param: ?peer_id=xxx
 */
router.get('/channels', async (req, res) => {
  try {
    const peerId = req.query.peer_id as string | undefined;
    const channels = await listChannels(peerId);
    res.json({ success: true, data: { channels, count: channels.length } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/fiber/channels/open
 * Open a new payment channel.
 * Body: { peer_id: string, funding_amount: string, public?: boolean }
 */
const openChannelSchema = z.object({
  peer_id: z.string().min(1, 'peer_id is required'),
  funding_amount: z.string().min(1, 'funding_amount is required'),
  public: z.boolean().default(true),
});

router.post('/channels/open', async (req, res) => {
  try {
    const parsed = openChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const { peer_id, funding_amount, public: isPublic } = parsed.data;
    const channelId = await openChannel(peer_id, funding_amount, isPublic);

    if (!channelId) {
      return res.status(500).json({ success: false, error: 'Failed to open channel' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_CHANNEL_OPENED',
      resourceType: 'FIBER',
      resourceId: channelId,
      metadata: { peerId: peer_id, fundingAmount: funding_amount },
    });
    res.json({ success: true, data: { temporary_channel_id: channelId } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/fiber/channels/close
 * Close a payment channel.
 * Body: { channel_id: string, peer_id: string, force?: boolean }
 */
const closeChannelSchema = z.object({
  channel_id: z.string().min(1, 'channel_id is required'),
  peer_id: z.string().min(1, 'peer_id is required'),
  force: z.boolean().default(false),
});

router.post('/channels/close', async (req, res) => {
  try {
    const parsed = closeChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const { channel_id, peer_id, force } = parsed.data;
    const closed = await closeChannel(channel_id, peer_id, force);

    if (!closed) {
      return res.status(500).json({ success: false, error: 'Failed to close channel' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_CHANNEL_CLOSE_REQUESTED',
      resourceType: 'FIBER',
      resourceId: channel_id,
      metadata: { peerId: peer_id, force },
    });
    res.json({ success: true, data: { message: 'Channel close initiated' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Peer Management ───

/**
 * POST /api/fiber/peers/connect
 * Connect to a Fiber peer.
 * Body: { address: string } — multiaddr format
 */
const connectPeerSchema = z.object({
  address: z.string().min(1, 'address is required'),
});

router.post('/peers/connect', async (req, res) => {
  try {
    const parsed = connectPeerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const connected = await connectPeer(parsed.data.address);
    if (!connected) {
      return res.status(500).json({ success: false, error: 'Failed to connect to peer' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_PEER_CONNECTED',
      resourceType: 'FIBER',
      resourceId: parsed.data.address,
    });
    res.json({ success: true, data: { message: 'Connected to peer' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/fiber/peers/disconnect
 * Disconnect from a Fiber peer.
 * Body: { peer_id: string }
 */
const disconnectPeerSchema = z.object({
  peer_id: z.string().min(1, 'peer_id is required'),
});

router.post('/peers/disconnect', async (req, res) => {
  try {
    const parsed = disconnectPeerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const disconnected = await disconnectPeer(parsed.data.peer_id);
    if (!disconnected) {
      return res.status(500).json({ success: false, error: 'Failed to disconnect peer' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_PEER_DISCONNECTED',
      resourceType: 'FIBER',
      resourceId: parsed.data.peer_id,
    });
    res.json({ success: true, data: { message: 'Disconnected from peer' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Payments ───

/**
 * GET /api/fiber/payments/:paymentHash
 * Get payment status by hash.
 */
router.get('/payments/:paymentHash', async (req, res) => {
  try {
    const { paymentHash } = req.params;
    const status = await getPaymentStatus(paymentHash);

    if (!status) {
      return res.status(404).json({ success: false, error: 'Payment not found or Fiber unavailable' });
    }

    res.json({ success: true, data: status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/fiber/invoices/create
 * Generate a Fiber invoice for receiving a payment.
 * Body: { amount: string, description: string, expiry?: number }
 */
const createInvoiceSchema = z.object({
  amount: z.string().min(1, 'amount is required'),
  description: z.string().min(1, 'description is required'),
  expiry: z.number().int().positive().default(3600),
});

router.post('/invoices/create', async (req, res) => {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const { amount, description, expiry } = parsed.data;
    const invoice = await generateInvoice(amount, description, expiry);

    if (!invoice) {
      return res.status(500).json({ success: false, error: 'Failed to generate invoice' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_INVOICE_CREATED',
      resourceType: 'FIBER',
      resourceId: invoice.paymentHash || invoice.invoice || 'invoice',
      metadata: { amount, expiry },
    });
    res.json({ success: true, data: invoice });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/fiber/invoices/pay
 * Pay a Fiber invoice.
 * Body: { invoice: string }
 */
const payInvoiceSchema = z.object({
  invoice: z.string().min(1, 'invoice is required'),
});

router.post('/invoices/pay', async (req, res) => {
  try {
    const parsed = payInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    }

    const paymentHash = await payInvoice(parsed.data.invoice);
    if (!paymentHash) {
      return res.status(500).json({ success: false, error: 'Failed to pay invoice' });
    }

    await createAuditLog({
      actorAddress: req.auth?.address,
      action: 'FIBER_INVOICE_PAID',
      resourceType: 'FIBER',
      resourceId: paymentHash,
    });
    res.json({ success: true, data: { payment_hash: paymentHash } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
