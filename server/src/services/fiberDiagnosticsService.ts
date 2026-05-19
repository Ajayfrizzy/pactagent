import { prisma } from '../db';
import { config } from '../config';
import { checkFiberHealth, getNodeInfo, listChannels, type FiberChannel, type FiberNodeInfo } from './fiberService';

type DiagnosticStatus =
  | 'DISABLED'
  | 'UNREACHABLE'
  | 'HEALTHY_NO_CHANNELS'
  | 'HEALTHY_NO_LIQUIDITY'
  | 'READY_UNPROVEN'
  | 'PAYMENT_PROVEN'
  | 'HISTORICALLY_FALLBACK_ONLY';

type EvidenceReason =
  | 'FIBER_DISABLED'
  | 'NODE_UNREACHABLE'
  | 'NO_CHANNELS'
  | 'NO_OUTBOUND_LIQUIDITY'
  | 'NO_PROVEN_FIBER_PAYMENT'
  | 'HAS_PROVEN_FIBER_PAYMENT'
  | 'FALLBACK_ONLY_HISTORY';

export type FiberDiagnostics = {
  status: DiagnosticStatus;
  summary: string;
  interpretation: string;
  evidenceReasons: EvidenceReason[];
  config: {
    fiberEnabled: boolean;
    fiberNodeUrl: string;
    hasApiKey: boolean;
  };
  live: {
    healthy: boolean;
    nodeInfo: FiberNodeInfo | null;
    nodePublicKey: string | null;
    peerCount: number;
    openChannelCount: number;
    pendingChannelCount: number;
    channels: Array<{
      channelId: string;
      peerId: string;
      stateName: string;
      localBalance: string;
      remoteBalance: string;
      outboundReady: boolean;
    }>;
    usableOutboundChannelCount: number;
  };
  history: {
    agreementsConfiguredForFiber: number;
    settlementsOnFiber: number;
    confirmedFiberSettlements: number;
    attemptedFiberPayoutLogs: number;
    confirmedFiberPayoutLogs: number;
    fallbackReleaseLogs: number;
    lastConfirmedFiberSettlementAt: string | null;
    lastFallbackAt: string | null;
    likelyNeverPaymentCapable: boolean;
    evidence: string[];
  };
};

function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hasPositiveBalance(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function isOutboundReady(channel: FiberChannel) {
  const stateName = channel.state?.state_name || '';
  return /open|active|ready/i.test(stateName) && hasPositiveBalance(channel.local_balance);
}

function summarizeChannels(channels: FiberChannel[]) {
  return channels.map((channel) => ({
    channelId: channel.channel_id,
    peerId: channel.peer_id,
    stateName: channel.state?.state_name || 'UNKNOWN',
    localBalance: channel.local_balance,
    remoteBalance: channel.remote_balance,
    outboundReady: isOutboundReady(channel),
  }));
}

export async function getFiberDiagnostics(): Promise<FiberDiagnostics> {
  const [healthy, nodeInfo, channels, agreementsConfiguredForFiber, settlementsOnFiber, confirmedFiberSettlements, attemptedFiberPayoutLogs, confirmedFiberPayoutLogs, recentReleaseLogs] = await Promise.all([
    checkFiberHealth(),
    getNodeInfo(),
    listChannels(),
    prisma.agreement.count({
      where: { payoutNetwork: 'FIBER' },
    }),
    prisma.milestoneSettlement.count({
      where: { network: 'FIBER' },
    }),
    prisma.milestoneSettlement.findMany({
      where: { network: 'FIBER', status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { createdAt: true, paymentReference: true, amount: true },
    }),
    prisma.agentLog.count({
      where: { eventType: 'FIBER_PAYOUT_INITIATED' },
    }),
    prisma.agentLog.count({
      where: { eventType: 'FIBER_PAYOUT_CONFIRMED' },
    }),
    prisma.agentLog.findMany({
      where: {
        eventType: 'RELEASE_SENT',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        createdAt: true,
        metadataJson: true,
        message: true,
      },
    }),
  ]);

  const channelSummaries = summarizeChannels(channels);
  const usableOutboundChannelCount = channelSummaries.filter((channel) => channel.outboundReady).length;

  const fallbackReleaseLogs = recentReleaseLogs.filter((entry) => {
    const metadata = safeParseJson<Record<string, unknown>>(entry.metadataJson);
    return metadata?.route === 'CKB_FALLBACK' || /fallback/i.test(entry.message);
  });

  const confirmedFiberSettlementCount = confirmedFiberSettlements.length;
  const lastConfirmedFiberSettlementAt = confirmedFiberSettlements[0]?.createdAt?.toISOString() || null;
  const lastFallbackAt = fallbackReleaseLogs[0]?.createdAt?.toISOString() || null;
  const evidence: string[] = [];
  const evidenceReasons: EvidenceReason[] = [];

  let status: DiagnosticStatus;
  let summary: string;
  let interpretation: string;

  if (!config.fiberEnabled) {
    status = 'DISABLED';
    summary = 'Fiber is disabled in the live backend configuration.';
    interpretation = 'The app is not currently using Fiber in production, so historic payout failures may simply reflect that the runtime was never truly enabled.';
    evidenceReasons.push('FIBER_DISABLED');
    evidence.push('`FIBER_ENABLED` is false in the live backend config.');
  } else if (!healthy) {
    status = 'UNREACHABLE';
    summary = 'Fiber is enabled in config, but the backend cannot currently reach the Fiber node.';
    interpretation = 'This points to a bad RPC URL, missing auth, or a node process/network problem rather than a payout-path issue.';
    evidenceReasons.push('NODE_UNREACHABLE');
    evidence.push('Live `/config` health would report Fiber enabled but unhealthy.');
  } else if (channelSummaries.length === 0) {
    status = confirmedFiberSettlementCount > 0 ? 'PAYMENT_PROVEN' : 'HEALTHY_NO_CHANNELS';
    summary = confirmedFiberSettlementCount > 0
      ? 'Fiber has historical confirmed settlements, but no channels are open right now.'
      : 'Fiber node is reachable, but it has no open channels.';
    interpretation = confirmedFiberSettlementCount > 0
      ? 'The node worked before, but its current routing state is not payment-capable.'
      : 'This is the classic “configured but not payment-capable” state: the node is alive, but routing prerequisites were never completed.';
    evidenceReasons.push('NO_CHANNELS');
    evidence.push('The live Fiber node returned zero channels.');
  } else if (usableOutboundChannelCount === 0) {
    status = confirmedFiberSettlementCount > 0 ? 'PAYMENT_PROVEN' : 'HEALTHY_NO_LIQUIDITY';
    summary = confirmedFiberSettlementCount > 0
      ? 'Fiber has historical confirmed settlements, but current channels show no usable outbound liquidity.'
      : 'Fiber node has channels, but none appear usable for outbound payout liquidity.';
    interpretation = confirmedFiberSettlementCount > 0
      ? 'The routing layer worked historically, but the current sender side likely cannot make payouts until liquidity is restored.'
      : 'This strongly suggests the old setup reached channel creation but never reached a sendable state.';
    evidenceReasons.push('NO_OUTBOUND_LIQUIDITY');
    evidence.push('The live Fiber node has channels, but none have positive local balance in an open-like state.');
  } else if (confirmedFiberSettlementCount > 0 || confirmedFiberPayoutLogs > 0) {
    status = 'PAYMENT_PROVEN';
    summary = 'Fiber has live routing prerequisites and historical evidence of real Fiber payout confirmation.';
    interpretation = 'Fiber is not just configured or reachable; the stored history proves that at least one payout actually succeeded over Fiber.';
    evidenceReasons.push('HAS_PROVEN_FIBER_PAYMENT');
    evidence.push(`Found ${confirmedFiberSettlementCount} confirmed Fiber settlement record(s).`);
  } else if (attemptedFiberPayoutLogs > 0 || fallbackReleaseLogs.length > 0 || agreementsConfiguredForFiber > 0) {
    status = 'HISTORICALLY_FALLBACK_ONLY';
    summary = 'Fiber appears configured and routing-ready now, but the stored history shows no confirmed Fiber payment.';
    interpretation = 'The most likely historical state is that Fiber was installed and maybe even attempted, but the app always ended up using CKB fallback instead of a real Fiber settlement.';
    evidenceReasons.push('NO_PROVEN_FIBER_PAYMENT', 'FALLBACK_ONLY_HISTORY');
    evidence.push(`Found ${attemptedFiberPayoutLogs} Fiber initiation log(s) but no confirmed Fiber settlement record.`);
  } else {
    status = 'READY_UNPROVEN';
    summary = 'Fiber looks configured and payment-capable from current node state, but there is no stored proof of a real Fiber payout yet.';
    interpretation = 'Infrastructure may now be ready, but payment functionality remains unproven until a real Fiber payment succeeds.';
    evidenceReasons.push('NO_PROVEN_FIBER_PAYMENT');
    evidence.push('Current node health and liquidity look usable, but no confirmed Fiber payout evidence exists in the database.');
  }

  if (agreementsConfiguredForFiber > 0) {
    evidence.push(`Found ${agreementsConfiguredForFiber} agreement(s) configured for Fiber payouts.`);
  }

  if (fallbackReleaseLogs.length > 0) {
    evidence.push(`Found ${fallbackReleaseLogs.length} recent release log(s) that indicate CKB fallback.`);
  }

  if (confirmedFiberPayoutLogs > 0 && confirmedFiberSettlementCount === 0) {
    evidence.push(`Found ${confirmedFiberPayoutLogs} Fiber confirmation log(s), but no confirmed settlement row was found.`);
  }

  return {
    status,
    summary,
    interpretation,
    evidenceReasons,
    config: {
      fiberEnabled: config.fiberEnabled,
      fiberNodeUrl: config.fiberNodeUrl,
      hasApiKey: Boolean(config.fiberApiKey),
    },
    live: {
      healthy,
      nodeInfo,
      nodePublicKey: nodeInfo?.public_key || null,
      peerCount: nodeInfo?.peers_count || 0,
      openChannelCount: nodeInfo?.open_channel_count || channelSummaries.length,
      pendingChannelCount: nodeInfo?.pending_channel_count || 0,
      channels: channelSummaries,
      usableOutboundChannelCount,
    },
    history: {
      agreementsConfiguredForFiber,
      settlementsOnFiber,
      confirmedFiberSettlements: confirmedFiberSettlementCount,
      attemptedFiberPayoutLogs,
      confirmedFiberPayoutLogs,
      fallbackReleaseLogs: fallbackReleaseLogs.length,
      lastConfirmedFiberSettlementAt,
      lastFallbackAt,
      likelyNeverPaymentCapable: confirmedFiberSettlementCount === 0 && confirmedFiberPayoutLogs === 0,
      evidence,
    },
  };
}
