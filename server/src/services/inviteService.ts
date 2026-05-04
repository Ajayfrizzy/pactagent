import { randomBytes, randomUUID } from 'crypto';
import { prisma } from '../db';
import { normalizeWalletAddress } from './authService';
import { createAgreement } from './agreementService';
import { getProfileSummaryByWalletAddress } from './profileService';

type AgreementTemplateInput = {
  title: string;
  description: string;
  deadlineAt: string;
  disputeWindowSecs: number;
  proofType: string;
  reviewerMode: string;
  releaseMode: string;
  payoutNetwork: string;
  escrowModel?: string;
  workerFiberPubkey?: string;
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
  }>;
};

function generateInviteToken() {
  return randomBytes(24).toString('base64url');
}

function parseTemplate(value: string) {
  return JSON.parse(value) as AgreementTemplateInput;
}

function isInviteExpired(invite: { expiresAt: Date | null; maxUses: number; useCount: number; isActive: boolean }) {
  if (!invite.isActive) {
    return true;
  }

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return true;
  }

  return invite.useCount >= invite.maxUses;
}

function serializeInvite(invite: {
  id: string;
  token: string;
  createdByAddress: string;
  creatorRole: string;
  targetRole: string;
  title: string | null;
  description: string | null;
  agreementTemplateJson: string;
  expiresAt: Date | null;
  maxUses: number;
  useCount: number;
  acceptedByAddress: string | null;
  acceptedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const template = parseTemplate(invite.agreementTemplateJson);
  return {
    ...invite,
    agreementTemplate: template,
    isExpired: isInviteExpired(invite),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
  };
}

export async function createInviteLink(params: {
  createdByAddress: string;
  creatorRole: 'CLIENT' | 'WORKER';
  targetRole: 'CLIENT' | 'WORKER';
  title?: string;
  description?: string;
  expiresAt?: string;
  maxUses?: number;
  agreementTemplate: AgreementTemplateInput;
}) {
  const createdByAddress = normalizeWalletAddress(params.createdByAddress);

  if (params.creatorRole === params.targetRole) {
    throw new Error('Invite creator role and target role must be different.');
  }

  const invite = await prisma.inviteLink.create({
    data: {
      id: randomUUID(),
      token: generateInviteToken(),
      createdByAddress,
      creatorRole: params.creatorRole,
      targetRole: params.targetRole,
      title: params.title?.trim() || params.agreementTemplate.title,
      description: params.description?.trim() || params.agreementTemplate.description,
      agreementTemplateJson: JSON.stringify(params.agreementTemplate),
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      maxUses: params.maxUses && params.maxUses > 0 ? params.maxUses : 1,
      useCount: 0,
      isActive: true,
    },
  });

  return serializeInvite(invite);
}

export async function getInviteLinkPreview(token: string) {
  const invite = await prisma.inviteLink.findUnique({
    where: { token },
  });

  if (!invite) {
    return null;
  }

  const creatorProfile = await getProfileSummaryByWalletAddress(invite.createdByAddress);
  return {
    ...serializeInvite(invite),
    creatorProfile,
  };
}

export async function listInvitesByCreator(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const invites = await prisma.inviteLink.findMany({
    where: { createdByAddress: normalizedAddress },
    orderBy: { createdAt: 'desc' },
  });

  return invites.map(serializeInvite);
}

export async function acceptInviteLink(token: string, acceptingAddress: string) {
  const invite = await prisma.inviteLink.findUnique({
    where: { token },
  });

  if (!invite) {
    throw new Error('Invite link not found.');
  }

  if (isInviteExpired(invite)) {
    throw new Error('This invite link has expired or already been used.');
  }

  const normalizedAcceptingAddress = normalizeWalletAddress(acceptingAddress);
  if (normalizedAcceptingAddress === invite.createdByAddress) {
    throw new Error('You cannot accept your own invite link.');
  }

  const template = parseTemplate(invite.agreementTemplateJson);
  const creatorProfile = await prisma.publicProfile.findUnique({
    where: { walletAddress: invite.createdByAddress },
  });
  const acceptingProfile = await prisma.publicProfile.findUnique({
    where: { walletAddress: normalizedAcceptingAddress },
  });

  const clientAddress =
    invite.creatorRole === 'CLIENT' ? invite.createdByAddress : normalizedAcceptingAddress;
  const workerAddress =
    invite.creatorRole === 'WORKER' ? invite.createdByAddress : normalizedAcceptingAddress;
  const workerFiberPubkey =
    template.workerFiberPubkey
    || (workerAddress === invite.createdByAddress ? creatorProfile?.fiberPubkey : acceptingProfile?.fiberPubkey)
    || undefined;

  const agreement = await createAgreement({
    ...template,
    clientAddress,
    workerAddress,
    workerFiberPubkey,
  });

  const now = new Date();
  await prisma.inviteLink.update({
    where: { id: invite.id },
    data: {
      useCount: { increment: 1 },
      acceptedByAddress: normalizedAcceptingAddress,
      acceptedAt: now,
      isActive: invite.useCount + 1 < invite.maxUses,
    },
  });

  return {
    agreement,
    acceptedAt: now.toISOString(),
  };
}
