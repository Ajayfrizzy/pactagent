import { prisma } from '../db';
import { createLog } from './logService';
import { config } from '../config';

/**
 * Fiber Integration Service
 *
 * Real integration with CKB Fiber Network (Layer 2 Payment Channels).
 * Enables fast, off-chain payments through payment channels.
 * If Fiber is unavailable, gracefully falls back to CKB on-chain settlement.
 *
 * Strategy:
 * - FULL release mode → pays on CKB directly
 * - PARTIAL release mode → prefers Fiber for fast incremental payouts
 * - Final settlement is always reflected on CKB state
 */

// ─── Types ───

export interface FiberPaymentResult {
  success: boolean;
  paymentReference: string | null;
  route: 'FIBER' | 'CKB_FALLBACK';
  message: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: any[];
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: { code: number; message: string; data?: any };
  id: number;
}

export interface FiberNodeInfo {
  node_name: string;
  public_key: string;
  addresses: string[];
  chain_hash: string;
  open_channel_count: number;
  pending_channel_count: number;
  peers_count: number;
  node_version: string;
}

export interface FiberChannel {
  channel_id: string;
  peer_id: string;
  state: { state_name: string; state_flags: string[] };
  local_balance: string;
  remote_balance: string;
  offered_tlc_balance: string;
  received_tlc_balance: string;
  created_at: string;
}

interface FiberSendPaymentParams {
  target_pubkey: string;
  amount: string;
  keysend: boolean;
  timeout?: number;
  max_fee_amount?: string;
  max_parts?: number;
}

export interface FiberPaymentStatus {
  payment_hash: string;
  status: 'Inflight' | 'Success' | 'Failed';
  failed_error?: string;
  created_at: string;
}

// ─── JSON-RPC Client ───

let rpcIdCounter = 1;

/**
 * Low-level JSON-RPC call to the Fiber node.
 */
async function fiberRpc<T = any>(method: string, params: any[] = []): Promise<T> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: rpcIdCounter++,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Support optional auth token (if the Fiber node is configured with one)
  if (config.fiberApiKey) {
    headers['Authorization'] = `Bearer ${config.fiberApiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

  try {
    const response = await fetch(config.fiberNodeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fiber RPC HTTP error: ${response.status} ${response.statusText}`);
    }

    const data: JsonRpcResponse = await response.json() as JsonRpcResponse;

    if (data.error) {
      throw new Error(`Fiber RPC error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Payment Functions ───

/**
 * Attempt payout through Fiber. Falls back to CKB if unavailable.
 */
export async function attemptFiberPayout(
  agreementId: string,
  workerAddress: string,
  amount: string
): Promise<FiberPaymentResult> {
  // Check if Fiber is enabled and configured
  if (!config.fiberEnabled) {
    await createLog({
      agreementId,
      level: 'INFO',
      eventType: 'FIBER_PAYOUT_INITIATED',
      message: 'Fiber not enabled — falling back to CKB settlement',
      metadata: { route: 'CKB_FALLBACK', reason: 'FIBER_DISABLED' },
    });

    return {
      success: true,
      paymentReference: null,
      route: 'CKB_FALLBACK',
      message: 'Fiber not enabled. Using CKB on-chain settlement.',
    };
  }

  try {
    // Attempt Fiber payment
    await createLog({
      agreementId,
      level: 'INFO',
      eventType: 'FIBER_PAYOUT_INITIATED',
      message: `Initiating Fiber payout of ${amount} shannons to ${workerAddress}`,
      metadata: { workerAddress, amount, fiberNode: config.fiberNodeUrl },
    });

    // Step 1: Send the payment via Fiber keysend
    const paymentHash = await sendFiberPayment(workerAddress, amount);

    // Step 2: Poll until confirmed or failed
    const confirmed = await waitForPaymentConfirmation(paymentHash);

    if (!confirmed) {
      throw new Error(`Payment ${paymentHash} was not confirmed within timeout`);
    }

    // Step 3: Save the payment reference in DB
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { fiberPaymentReference: paymentHash },
    });

    await createLog({
      agreementId,
      level: 'SUCCESS',
      eventType: 'FIBER_PAYOUT_CONFIRMED',
      message: `Fiber payout confirmed: ${paymentHash}`,
      metadata: { paymentReference: paymentHash, route: 'FIBER' },
    });

    return {
      success: true,
      paymentReference: paymentHash,
      route: 'FIBER',
      message: `Fiber payment sent successfully. Payment hash: ${paymentHash}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown Fiber error';

    await createLog({
      agreementId,
      level: 'WARN',
      eventType: 'ERROR',
      message: `Fiber payout failed: ${errMsg}. Falling back to CKB.`,
      metadata: { error: errMsg, route: 'CKB_FALLBACK' },
    });

    return {
      success: true,
      paymentReference: null,
      route: 'CKB_FALLBACK',
      message: `Fiber unavailable (${errMsg}). Falling back to CKB on-chain settlement.`,
    };
  }
}

/**
 * Send payment through the Fiber Network using keysend.
 *
 * Keysend allows sending payments without an invoice — the recipient
 * just needs a public key and an open channel (or route through the network).
 */
async function sendFiberPayment(
  targetPubkey: string,
  amount: string
): Promise<string> {
  console.log(`[FIBER] Sending payment: ${amount} shannons → ${targetPubkey}`);

  const params: FiberSendPaymentParams = {
    target_pubkey: targetPubkey,
    amount,
    keysend: true,
    timeout: 60,                // 60 second timeout for path finding + payment
    max_fee_amount: '10000',    // max 10,000 shannons fee (0.0001 CKB)
  };

  const result = await fiberRpc<FiberPaymentStatus>('send_payment', [params]);

  console.log(`[FIBER] Payment initiated: hash=${result.payment_hash}, status=${result.status}`);
  return result.payment_hash;
}

/**
 * Poll `get_payment` until the payment is confirmed or fails.
 */
async function waitForPaymentConfirmation(
  paymentHash: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fiberRpc<FiberPaymentStatus>('get_payment', [{ payment_hash: paymentHash }]);

      if (result.status === 'Success') {
        console.log(`[FIBER] Payment ${paymentHash} confirmed on attempt ${attempt}`);
        return true;
      }

      if (result.status === 'Failed') {
        console.error(`[FIBER] Payment ${paymentHash} failed: ${result.failed_error}`);
        throw new Error(`Payment failed: ${result.failed_error || 'unknown reason'}`);
      }

      // Status is 'Inflight' — still pending
      console.log(`[FIBER] Payment ${paymentHash} inflight (attempt ${attempt}/${maxAttempts})`);
    } catch (error) {
      // Re-throw explicit payment failures
      if (error instanceof Error && error.message.startsWith('Payment failed:')) {
        throw error;
      }
      // RPC errors might be transient — log and keep polling
      console.warn(`[FIBER] Error polling payment status (attempt ${attempt}): ${error}`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false; // timed out
}

// ─── Node Health & Info ───

/**
 * Check if Fiber node is available and healthy.
 */
export async function checkFiberHealth(): Promise<boolean> {
  if (!config.fiberEnabled) return false;

  try {
    const info = await fiberRpc<FiberNodeInfo>('node_info');
    console.log(
      `[FIBER] Node healthy: ${info.node_name || 'unnamed'} v${info.node_version}, ` +
      `channels: ${info.open_channel_count}, peers: ${info.peers_count}`
    );
    return true;
  } catch (error) {
    console.warn(`[FIBER] Health check failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Get detailed Fiber node information.
 */
export async function getNodeInfo(): Promise<FiberNodeInfo | null> {
  if (!config.fiberEnabled) return null;

  try {
    return await fiberRpc<FiberNodeInfo>('node_info');
  } catch (error) {
    console.warn(`[FIBER] Failed to get node info: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

// ─── Channel Management ───

/**
 * List all payment channels, optionally filtered by peer ID.
 */
export async function listChannels(peerId?: string): Promise<FiberChannel[]> {
  if (!config.fiberEnabled) return [];

  try {
    const params = peerId ? [{ peer_id: peerId }] : [{}];
    const result = await fiberRpc<{ channels: FiberChannel[] }>('list_channels', params);
    return result.channels || [];
  } catch (error) {
    console.warn(`[FIBER] Failed to list channels: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Open a new payment channel with a peer.
 *
 * @param peerAddress - The peer's public key / address
 * @param fundingAmount - Amount in shannons to fund the channel with
 * @param publicChannel - Whether the channel should be publicly announced for routing
 * @returns The temporary channel ID if successful
 */
export async function openChannel(
  peerAddress: string,
  fundingAmount: string,
  publicChannel: boolean = true
): Promise<string | null> {
  if (!config.fiberEnabled) return null;

  try {
    console.log(`[FIBER] Opening channel: peer=${peerAddress}, funding=${fundingAmount}`);

    const result = await fiberRpc<{ temporary_channel_id: string }>('open_channel', [{
      peer_id: peerAddress,
      funding_amount: fundingAmount,
      public: publicChannel,
    }]);

    console.log(`[FIBER] Channel opening initiated: ${result.temporary_channel_id}`);
    return result.temporary_channel_id;
  } catch (error) {
    console.error(`[FIBER] Failed to open channel: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Close (cooperatively shutdown) a payment channel.
 *
 * @param channelId - The channel ID to close
 * @param peerAddress - The peer's public key
 * @param force - Whether to force close (unilateral) if cooperative close fails
 */
export async function closeChannel(
  channelId: string,
  peerAddress: string,
  force: boolean = false
): Promise<boolean> {
  if (!config.fiberEnabled) return false;

  try {
    console.log(`[FIBER] Closing channel: ${channelId} (force=${force})`);

    await fiberRpc('shutdown_channel', [{
      channel_id: channelId,
      peer_id: peerAddress,
      force,
    }]);

    console.log(`[FIBER] Channel close initiated: ${channelId}`);
    return true;
  } catch (error) {
    console.error(`[FIBER] Failed to close channel: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

// ─── Peer Management ───

/**
 * Connect to a Fiber network peer.
 *
 * @param address - Multiaddr of the peer (e.g., "/ip4/127.0.0.1/tcp/8228/p2p/<peer_id>")
 */
export async function connectPeer(address: string): Promise<boolean> {
  if (!config.fiberEnabled) return false;

  try {
    console.log(`[FIBER] Connecting to peer: ${address}`);
    await fiberRpc('connect_peer', [{ address }]);
    console.log(`[FIBER] Connected to peer: ${address}`);
    return true;
  } catch (error) {
    console.error(`[FIBER] Failed to connect peer: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Disconnect from a Fiber network peer.
 */
export async function disconnectPeer(peerId: string): Promise<boolean> {
  if (!config.fiberEnabled) return false;

  try {
    await fiberRpc('disconnect_peer', [{ peer_id: peerId }]);
    console.log(`[FIBER] Disconnected peer: ${peerId}`);
    return true;
  } catch (error) {
    console.error(`[FIBER] Failed to disconnect peer: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

// ─── Invoice-based Payments ───

/**
 * Generate a Fiber invoice for receiving payments.
 *
 * @param amount - Amount in shannons
 * @param description - Human-readable description
 * @param expiry - Expiry time in seconds (default: 3600 = 1 hour)
 */
export async function generateInvoice(
  amount: string,
  description: string,
  expiry: number = 3600
): Promise<{ paymentHash: string; invoice: string } | null> {
  if (!config.fiberEnabled) return null;

  try {
    const result = await fiberRpc<{ invoice_address: string; invoice: { data: { payment_hash: string } } }>(
      'new_invoice',
      [{
        amount,
        description,
        expiry: `0x${expiry.toString(16)}`,
        currency: 'Fibb',
        payment_preimage: generatePreimage(),
      }]
    );

    return {
      paymentHash: result.invoice.data.payment_hash,
      invoice: result.invoice_address,
    };
  } catch (error) {
    console.error(`[FIBER] Failed to generate invoice: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Pay a Fiber invoice.
 */
export async function payInvoice(invoice: string): Promise<string | null> {
  if (!config.fiberEnabled) return null;

  try {
    console.log(`[FIBER] Paying invoice...`);
    const result = await fiberRpc<FiberPaymentStatus>('send_payment', [{
      invoice,
    }]);

    console.log(`[FIBER] Invoice payment initiated: hash=${result.payment_hash}`);

    // Wait for confirmation
    const confirmed = await waitForPaymentConfirmation(result.payment_hash);
    if (!confirmed) {
      throw new Error('Invoice payment not confirmed within timeout');
    }

    return result.payment_hash;
  } catch (error) {
    console.error(`[FIBER] Failed to pay invoice: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Get the status of a specific payment by its hash.
 */
export async function getPaymentStatus(paymentHash: string): Promise<FiberPaymentStatus | null> {
  if (!config.fiberEnabled) return null;

  try {
    return await fiberRpc<FiberPaymentStatus>('get_payment', [{ payment_hash: paymentHash }]);
  } catch {
    return null;
  }
}

// ─── Helpers ───

/**
 * Generate a random 32-byte hex preimage for invoices.
 */
function generatePreimage(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
