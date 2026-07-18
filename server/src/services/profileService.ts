import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { normalizeWalletAddress } from './authService';
import { getPublicLogsForParticipantAddress } from './logService';
import { getReputationSnapshot } from './reputationService';

type ProfileLink = {
  label: string;
  url: string;
};

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugifyHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

async function ensureUniqueHandle(baseHandle: string, walletAddress: string) {
  const normalizedBase = slugifyHandle(baseHandle) || `ckb-${walletAddress.slice(-8)}`;
  let candidate = normalizedBase;
  let suffix = 1;

  while (true) {
    const existing = await prisma.publicProfile.findUnique({
      where: { handle: candidate },
      select: { walletAddress: true },
    });

    if (!existing || existing.walletAddress === walletAddress) {
      return candidate;
    }

    suffix += 1;
    candidate = `${normalizedBase.slice(0, Math.max(1, 28))}-${suffix}`;
  }
}

function serializeProfile(profile: {
  id: string;
  walletAddress: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  skillsJson: string | null;
  linksJson: string | null;
  fiberPubkey: string | null;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { fiberPubkey: _deprecatedFiberPubkey, ...publicProfile } = profile;
  return {
    ...publicProfile,
    skills: parseJsonArray<string>(profile.skillsJson),
    links: parseJsonArray<ProfileLink>(profile.linksJson),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function ensureProfile(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const existing = await prisma.publicProfile.findUnique({
    where: { walletAddress: normalizedAddress },
  });

  if (existing) {
    return existing;
  }

  const handle = await ensureUniqueHandle(`ckb-${normalizedAddress.slice(-8)}`, normalizedAddress);
  return prisma.publicProfile.create({
    data: {
      id: randomUUID(),
      walletAddress: normalizedAddress,
      handle,
      displayName: `CKB ${normalizedAddress.slice(-6)}`,
      visibility: 'PUBLIC',
    },
  });
}

export async function getMyProfile(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const profile = serializeProfile(await ensureProfile(normalizedAddress));
  const reputation = await getReputationSnapshot(normalizedAddress);
  return {
    ...profile,
    reputation: {
      ...reputation,
      updatedAt: reputation.updatedAt.toISOString(),
    },
  };
}

export async function updateMyProfile(walletAddress: string, input: {
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  skills?: string[];
  links?: ProfileLink[];
  visibility?: 'PUBLIC' | 'PRIVATE';
}) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  await ensureProfile(normalizedAddress);
  const nextHandle = input.handle
    ? await ensureUniqueHandle(input.handle, normalizedAddress)
    : undefined;

  const updated = await prisma.publicProfile.update({
    where: { walletAddress: normalizedAddress },
    data: {
      handle: nextHandle,
      displayName: input.displayName?.trim() || null,
      bio: input.bio?.trim() || null,
      avatarUrl: input.avatarUrl?.trim() || null,
      skillsJson: input.skills ? JSON.stringify(input.skills.filter(Boolean)) : undefined,
      linksJson: input.links ? JSON.stringify(input.links.filter((link) => link.url)) : undefined,
      visibility: input.visibility || undefined,
    },
  });

  const reputation = await getReputationSnapshot(normalizedAddress);
  return {
    ...serializeProfile(updated),
    reputation: {
      ...reputation,
      updatedAt: reputation.updatedAt.toISOString(),
    },
  };
}

export async function getProfileSummaryByWalletAddress(walletAddress: string) {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const profile = await prisma.publicProfile.findUnique({
    where: { walletAddress: normalizedAddress },
  });

  if (!profile || profile.visibility !== 'PUBLIC') {
    return null;
  }

  return serializeProfile(profile);
}

export async function getPublicProfileByHandle(handle: string) {
  const profile = await prisma.publicProfile.findUnique({
    where: { handle: slugifyHandle(handle) },
  });

  if (!profile || profile.visibility !== 'PUBLIC') {
    return null;
  }

  const reputation = await getReputationSnapshot(profile.walletAddress);
  return {
    ...serializeProfile(profile),
    reputation: {
      ...reputation,
      updatedAt: reputation.updatedAt.toISOString(),
    },
  };
}

export async function getPublicProfileReputationByHandle(handle: string) {
  const profile = await prisma.publicProfile.findUnique({
    where: { handle: slugifyHandle(handle) },
  });

  if (!profile || profile.visibility !== 'PUBLIC') {
    return null;
  }

  const reputation = await getReputationSnapshot(profile.walletAddress);
  return {
    ...reputation,
    handle: profile.handle,
    updatedAt: reputation.updatedAt.toISOString(),
  };
}

export async function getPublicProfileActivityByHandle(handle: string, limit = 25) {
  const profile = await prisma.publicProfile.findUnique({
    where: { handle: slugifyHandle(handle) },
  });

  if (!profile || profile.visibility !== 'PUBLIC') {
    return null;
  }

  const logs = await getPublicLogsForParticipantAddress(profile.walletAddress, limit);
  return {
    walletAddress: profile.walletAddress,
    handle: profile.handle,
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
      metadataJson: null,
    })),
  };
}
