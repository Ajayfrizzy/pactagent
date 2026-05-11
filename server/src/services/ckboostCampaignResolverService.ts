import { ClientPublicMainnet, ClientPublicTestnet, Script, bytesFrom, hexFrom, mol, numFrom } from '@ckb-ccc/core';
import { config } from '../config';

const EMPTY_HEX = '0x';

type ConnectedTypeId = {
  type_id: string;
  connected_key: string;
};

const ConnectedTypeIdCodec = mol.table({
  type_id: mol.Byte32,
  connected_key: mol.Byte32,
});

const RewardAssetCodec = mol.table({
  udt_script: Script,
  amount: mol.Uint128,
});

const RewardAssetVecCodec = mol.vector(RewardAssetCodec);

const RewardBundleCodec = mol.table({
  points_amount: mol.Uint128,
  ckb_amount: mol.Uint128,
  nft_assets: mol.vector(Script),
  udt_assets: RewardAssetVecCodec,
});

const RewardBundleVecCodec = mol.vector(RewardBundleCodec);

const QuestSubtaskCodec = mol.table({
  id: mol.Uint8,
  title: mol.String,
  type: mol.String,
  description: mol.String,
  proof_required: mol.String,
});

const QuestSubtaskVecCodec = mol.vector(QuestSubtaskCodec);

const QuestMetadataCodec = mol.table({
  title: mol.String,
  short_description: mol.String,
  long_description: mol.String,
  requirements: mol.String,
  difficulty: mol.Uint8,
  time_estimate: mol.Uint32,
});

const QuestCodec = mol.table({
  quest_id: mol.Uint32,
  metadata: QuestMetadataCodec,
  rewards_on_completion: RewardBundleVecCodec,
  accepted_submission_user_type_ids: mol.Byte32Vec,
  completion_deadline: mol.Uint64,
  status: mol.Uint8,
  sub_tasks: QuestSubtaskVecCodec,
  points: mol.Uint128,
  completion_count: mol.Uint32,
});

const QuestVecCodec = mol.vector(QuestCodec);

const CampaignMetadataCodec = mol.table({
  title: mol.String,
  short_description: mol.String,
  long_description: mol.String,
  total_rewards: RewardBundleCodec,
  verification_requirements: mol.Uint8Vec,
  last_updated: mol.Uint64,
  categories: mol.StringVec,
  difficulty: mol.Uint8,
  image_url: mol.String,
});

const CampaignCodec = mol.table({
  endorser_lock_hash: mol.Byte32,
  staff_lock_hash_vec: mol.Byte32Vec,
  created_at: mol.Uint64,
  starting_time: mol.Uint64,
  ending_time: mol.Uint64,
  rules: mol.StringVec,
  metadata: CampaignMetadataCodec,
  status: mol.Uint8,
  quests: QuestVecCodec,
  participants_count: mol.Uint32,
  total_completions: mol.Uint32,
});

type AutoFillMilestone = {
  title: string;
  description: string;
  amountCkb: string;
};

export type CkboostCampaignAutoFill = {
  campaignId: string;
  campaignUrl: string;
  campaignTitle: string;
  campaignDescription: string;
  questBundleTitle?: string;
  agreementTitle: string;
  agreementDescription: string;
  governanceThreadUrl?: string;
  sponsorName?: string;
  rules: string[];
  milestones: AutoFillMilestone[];
  stats: {
    participantsCount: number;
    totalCompletions: number;
    questCount: number;
    totalPoints: number;
    startsAt?: string;
    endsAt?: string;
  };
};

type ClientWithFindCells = ClientPublicMainnet | ClientPublicTestnet;

function getClient(): ClientWithFindCells {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

function asHexString(value: string) {
  return value.startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

function normalizeByte32(value: string) {
  const normalized = asHexString(value);
  const withoutPrefix = normalized.slice(2);

  if (!/^[0-9a-f]{64}$/i.test(withoutPrefix)) {
    throw new Error('CKBoost campaign ID must be a 32-byte hex value.');
  }

  return normalized;
}

export function extractCampaignIdFromInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a CKBoost campaign link or campaign ID.');
  }

  if (trimmed.startsWith('0x')) {
    return normalizeByte32(trimmed);
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    const campaignIndex = segments.findIndex((segment) => segment.toLowerCase() === 'campaign');
    const candidate = campaignIndex >= 0 ? segments[campaignIndex + 1] : segments[segments.length - 1];

    if (!candidate) {
      throw new Error('Campaign link is missing the CKBoost campaign ID.');
    }

    return normalizeByte32(candidate);
  } catch (error) {
    if (error instanceof Error && error.message.includes('CKBoost campaign ID')) {
      throw error;
    }

    throw new Error('Enter a valid CKBoost campaign link or campaign ID.');
  }
}

function buildCampaignUrl(campaignId: string) {
  return `${config.ckboostCampaignBaseUrl.replace(/\/$/, '')}/${campaignId}`;
}

async function getProtocolConnectedKey(client: ClientWithFindCells) {
  const search = client.findCells({
    script: {
      codeHash: config.ckboostProtocolTypeHash,
      hashType: 'type',
      args: config.ckboostProtocolCellArgs,
    },
    scriptType: 'type',
    scriptSearchMode: 'exact',
  });

  const result = await search.next();
  if (result.done || !result.value?.cellOutput?.type) {
    throw new Error('Unable to locate the CKBoost protocol cell on the configured CKB network.');
  }

  return result.value.cellOutput.type.hash();
}

async function findCampaignCell(client: ClientWithFindCells, campaignId: string, connectedKey: string) {
  const args = hexFrom(ConnectedTypeIdCodec.encode({
    type_id: campaignId,
    connected_key: connectedKey,
  } satisfies ConnectedTypeId));

  for await (const cell of client.findCells({
    script: {
      codeHash: config.ckboostCampaignTypeHash,
      hashType: 'type',
      args,
    },
    scriptType: 'type',
    scriptSearchMode: 'exact',
    withData: true,
  })) {
    return cell;
  }

  return null;
}

function stringifyMoleculeField(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    const candidate = value as {
      raw_data?: () => string;
      raw?: () => string;
      toString?: () => string;
    };

    if (typeof candidate.raw_data === 'function') {
      return Buffer.from(bytesFrom(candidate.raw_data())).toString('utf8').trim();
    }

    if (typeof candidate.raw === 'function') {
      return Buffer.from(bytesFrom(candidate.raw())).toString('utf8').trim();
    }

    if (typeof candidate.toString === 'function') {
      const text = candidate.toString();
      if (typeof text === 'string' && text !== '[object Object]') {
        return text.trim();
      }
    }
  }

  return '';
}

function safeNumber(value: unknown) {
  try {
    return Number(numFrom(value as string | number | bigint));
  } catch {
    return 0;
  }
}

function toIsoIfPresent(unixSeconds: number) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return undefined;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

function toCkbAmountString(shannons: unknown) {
  try {
    const amount = BigInt(numFrom(shannons as string | number | bigint));
    if (amount <= BigInt(0)) {
      return '';
    }

    const whole = amount / BigInt(100_000_000);
    const fraction = amount % BigInt(100_000_000);
    if (fraction === BigInt(0)) {
      return whole.toString();
    }

    return `${whole}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`;
  } catch {
    return '';
  }
}

function buildQuestDescription(quest: Record<string, unknown>) {
  const metadata = (quest.metadata || {}) as Record<string, unknown>;
  const longDescription = stringifyMoleculeField(metadata.long_description);
  const shortDescription = stringifyMoleculeField(metadata.short_description);
  const requirements = stringifyMoleculeField(metadata.requirements);
  const subtasks = Array.isArray(quest.sub_tasks) ? quest.sub_tasks : [];

  const parts: string[] = [];
  if (shortDescription) {
    parts.push(shortDescription);
  }
  if (longDescription && longDescription !== shortDescription) {
    parts.push(longDescription);
  }
  if (requirements) {
    parts.push(`Requirements: ${requirements}`);
  }
  if (subtasks.length) {
    const subtaskLines = subtasks
      .map((item) => item as Record<string, unknown>)
      .map((subtask, index) => {
        const title = stringifyMoleculeField(subtask.title) || `Subtask ${index + 1}`;
        const description = stringifyMoleculeField(subtask.description);
        const proofRequired = stringifyMoleculeField(subtask.proof_required);
        const detail = [description, proofRequired ? `Proof: ${proofRequired}` : '']
          .filter(Boolean)
          .join(' ');

        return detail ? `${title}: ${detail}` : title;
      });

    parts.push(`Subtasks: ${subtaskLines.join(' | ')}`);
  }

  return parts.filter(Boolean).join('\n\n');
}

function buildMilestonesFromCampaign(decodedCampaign: Record<string, unknown>) {
  const quests = Array.isArray(decodedCampaign.quests) ? decodedCampaign.quests : [];

  return quests.map((quest, index) => {
    const questRecord = quest as Record<string, unknown>;
    const metadata = (questRecord.metadata || {}) as Record<string, unknown>;
    const title = stringifyMoleculeField(metadata.title) || `Quest ${index + 1}`;
    const description = buildQuestDescription(questRecord) || 'Complete the deliverable and submit reviewer-ready proof.';
    const rewards = Array.isArray(questRecord.rewards_on_completion) ? questRecord.rewards_on_completion : [];
    const ckbReward = rewards
      .map((reward) => reward as Record<string, unknown>)
      .map((reward) => toCkbAmountString(reward.ckb_amount))
      .find(Boolean);

    return {
      title,
      description,
      amountCkb: ckbReward || '',
    };
  });
}

function deriveCampaignDescription(decodedCampaign: Record<string, unknown>) {
  const metadata = (decodedCampaign.metadata || {}) as Record<string, unknown>;
  const shortDescription = stringifyMoleculeField(metadata.short_description);
  const longDescription = stringifyMoleculeField(metadata.long_description);
  const rules = Array.isArray(decodedCampaign.rules)
    ? decodedCampaign.rules.map((item) => stringifyMoleculeField(item)).filter(Boolean)
    : [];
  const parts = [shortDescription, longDescription];

  if (rules.length) {
    parts.push(`Rules: ${rules.join(' | ')}`);
  }

  return parts.filter(Boolean).join('\n\n');
}

function decodeCampaignCellOutput(outputData: string) {
  return CampaignCodec.decode(bytesFrom(outputData)) as Record<string, unknown>;
}

export async function resolveCkboostCampaignAutoFill(input: string): Promise<CkboostCampaignAutoFill> {
  const campaignId = extractCampaignIdFromInput(input);
  const client = getClient();
  const connectedKey = await getProtocolConnectedKey(client);
  const campaignCell = await findCampaignCell(client, campaignId, connectedKey);

  if (!campaignCell?.outputData || campaignCell.outputData === EMPTY_HEX) {
    throw new Error('Unable to find that CKBoost campaign on the configured CKB network.');
  }

  const decodedCampaign = decodeCampaignCellOutput(campaignCell.outputData);
  const metadata = (decodedCampaign.metadata || {}) as Record<string, unknown>;
  const title = stringifyMoleculeField(metadata.title) || 'CKBoost Campaign';
  const description = deriveCampaignDescription(decodedCampaign);
  const milestones = buildMilestonesFromCampaign(decodedCampaign);
  const totalQuestPoints = (Array.isArray(decodedCampaign.quests) ? decodedCampaign.quests : [])
    .reduce((sum, quest) => sum + safeNumber((quest as Record<string, unknown>).points), 0);

  return {
    campaignId,
    campaignUrl: buildCampaignUrl(campaignId),
    campaignTitle: title,
    campaignDescription: description,
    questBundleTitle: `${title} Quest Bundle`,
    agreementTitle: `${title} Delivery Agreement`,
    agreementDescription: description,
    rules: Array.isArray(decodedCampaign.rules)
      ? decodedCampaign.rules.map((item) => stringifyMoleculeField(item)).filter(Boolean)
      : [],
    milestones,
    stats: {
      participantsCount: safeNumber(decodedCampaign.participants_count),
      totalCompletions: safeNumber(decodedCampaign.total_completions),
      questCount: Array.isArray(decodedCampaign.quests) ? decodedCampaign.quests.length : 0,
      totalPoints: totalQuestPoints,
      startsAt: toIsoIfPresent(safeNumber(decodedCampaign.starting_time)),
      endsAt: toIsoIfPresent(safeNumber(decodedCampaign.ending_time)),
    },
  };
}
