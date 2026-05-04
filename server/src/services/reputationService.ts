import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { normalizeWalletAddress } from './authService';

function percent(part: number, total: number) {
  if (!total) {
    return 0;
  }

  return Number(((part / total) * 100).toFixed(2));
}

function sumAmounts(values: string[]) {
  return values.reduce((sum, value) => sum + BigInt(value || '0'), BigInt(0)).toString();
}

export async function recomputeReputationSnapshot(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const agreements = await prisma.agreement.findMany({
    where: {
      OR: [
        { clientAddress: normalizedAddress },
        { workerAddress: normalizedAddress },
      ],
    },
    include: {
      disputes: {
        select: { id: true },
      },
      settlements: {
        select: {
          direction: true,
          status: true,
          amount: true,
        },
      },
      milestones: {
        select: {
          status: true,
        },
      },
      source: {
        select: { id: true },
      },
    },
  });

  const completedAgreements = agreements.filter((agreement) => agreement.status === 'PAID').length;
  const totalFundedAmount = sumAmounts(
    agreements
      .filter((agreement) => agreement.clientAddress === normalizedAddress && agreement.fundingConfirmedAt)
      .map((agreement) => agreement.amount),
  );

  const payoutSettlements = agreements.flatMap((agreement) =>
    agreement.workerAddress === normalizedAddress
      ? agreement.settlements.filter((settlement) => settlement.direction === 'PAYOUT')
      : [],
  );
  const confirmedPayoutSettlements = payoutSettlements.filter((settlement) => settlement.status === 'CONFIRMED');
  const totalPaidAmount = sumAmounts(confirmedPayoutSettlements.map((settlement) => settlement.amount));
  const payoutSuccessRate = percent(confirmedPayoutSettlements.length, payoutSettlements.length);

  const disputedAgreements = agreements.filter((agreement) => agreement.disputes.length > 0).length;
  const disputeRate = percent(disputedAgreements, agreements.length);

  const counterpartyCounts = new Map<string, number>();
  for (const agreement of agreements) {
    const counterparty =
      agreement.clientAddress === normalizedAddress
        ? agreement.workerAddress
        : agreement.clientAddress;
    counterpartyCounts.set(counterparty, (counterpartyCounts.get(counterparty) || 0) + 1);
  }

  const repeatCounterpartyCount = Array.from(counterpartyCounts.values()).filter((count) => count > 1).length;

  const paidMilestones = agreements.flatMap((agreement) =>
    agreement.milestones.filter((milestone) => milestone.status === 'PAID').map(() => agreement),
  );
  const onTimeMilestoneRate = percent(
    paidMilestones.filter((agreement) => agreement.updatedAt <= agreement.deadlineAt).length,
    paidMilestones.length,
  );

  const sourceAgreementCount = agreements.filter((agreement) => Boolean(agreement.source)).length;

  return prisma.reputationSnapshot.upsert({
    where: { walletAddress: normalizedAddress },
    update: {
      completedAgreements,
      totalFundedAmount,
      totalPaidAmount,
      payoutSuccessRate,
      disputeRate,
      repeatCounterpartyCount,
      onTimeMilestoneRate,
      sourceAgreementCount,
    },
    create: {
      id: randomUUID(),
      walletAddress: normalizedAddress,
      completedAgreements,
      totalFundedAmount,
      totalPaidAmount,
      payoutSuccessRate,
      disputeRate,
      repeatCounterpartyCount,
      onTimeMilestoneRate,
      sourceAgreementCount,
    },
  });
}

export async function refreshReputationForAgreement(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: {
      clientAddress: true,
      workerAddress: true,
    },
  });

  if (!agreement) {
    return null;
  }

  const [clientSnapshot, workerSnapshot] = await Promise.all([
    recomputeReputationSnapshot(agreement.clientAddress),
    recomputeReputationSnapshot(agreement.workerAddress),
  ]);

  return { clientSnapshot, workerSnapshot };
}

export async function getReputationSnapshot(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const existing = await prisma.reputationSnapshot.findUnique({
    where: { walletAddress: normalizedAddress },
  });

  if (existing) {
    return existing;
  }

  return recomputeReputationSnapshot(normalizedAddress);
}
