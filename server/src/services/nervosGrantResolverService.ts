import { config } from '../config';
import {
  discourseCookedHtmlToText,
  fetchDiscourseTopicJson,
  parseDiscourseTopicTarget,
  type DiscourseTopicPayload,
  type DiscourseTopicPost,
} from './discourseThreadService';

type ImportedGrantMilestoneKind = 'COMMENCEMENT' | 'DELIVERABLE';

export type ImportedGrantMilestoneDraft = {
  title: string;
  description: string;
  amountCkb: string;
  sourceBudgetLabel?: string;
  kind: ImportedGrantMilestoneKind;
};

export type NervosGrantSourceMetadata = {
  provider: 'DISCOURSE';
  parser: 'NERVOS_GRANT_THREAD_V1';
  sourceKind: 'NERVOS_GRANT_THREAD';
  threadUrl: string;
  topicId: number | null;
  topicTitle: string;
  topicAuthor: string | null;
  topicCreatedAt: string | null;
  topicLastPostedAt: string | null;
  postsCount: number;
  tags: string[];
  votPageUrl: string | null;
  grantAmountRequested: string | null;
  etaToCompletion: string | null;
  fundingAddress: string | null;
  summary: string;
  projectIntroduction: string;
  currentStatus: string;
  applicationDesign: string;
  keyBenefits: string;
  outOfScope: string;
  riskMitigation: string;
  upfrontPayment: {
    percentage: string | null;
    amountUsd: string | null;
    label: string | null;
  };
  milestones: Array<{
    index: number;
    title: string;
    description: string;
    budgetAmountUsd: string | null;
    budgetPercent: string | null;
    kind: ImportedGrantMilestoneKind;
  }>;
  rawBudgetBreakdown: Array<{
    label: string;
    amount: string;
  }>;
  sourceLastSyncedAt: string;
  missingFields: string[];
};

export type NervosGrantAutofillResult = {
  sourceType: 'DAO';
  sourceLabel: string;
  externalUrl: string;
  forumThreadUrl: string;
  sourceReferenceId?: string;
  sponsorName?: string;
  bountyTitle: string;
  bountyDescription: string;
  governanceNotes: string;
  agreementTitle: string;
  agreementDescription: string;
  deadlineDays: string;
  milestones: ImportedGrantMilestoneDraft[];
  sourceMetadata: NervosGrantSourceMetadata;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripDiscussionPrefix(title: string) {
  return title.replace(/^\s*\[[^\]]+\]\s*/g, '').trim();
}

function sectionLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function findLineIndex(lines: string[], pattern: RegExp) {
  return lines.findIndex((line) => pattern.test(line));
}

function collectSection(lines: string[], startPattern: RegExp, endPatterns: RegExp[]) {
  const startIndex = findLineIndex(lines, startPattern);
  if (startIndex < 0) {
    return '';
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (endPatterns.some((pattern) => pattern.test(lines[index]))) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join('\n').trim();
}

function maybeText(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  if (/^to be provided$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function extractLabeledValue(section: string, label: string) {
  const lines = sectionLines(section);
  const index = lines.findIndex((line) => normalizeWhitespace(line).toLowerCase() === label.toLowerCase());

  if (index < 0) {
    const regex = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*(.+)`, 'i');
    const match = normalizeWhitespace(section).match(regex);
    return maybeText(match?.[1] || '');
  }

  return maybeText(lines[index + 1] || '');
}

function extractUrl(text: string, label: string) {
  const regex = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*(https?:\\/\\/\\S+)`, 'i');
  const match = text.match(regex);
  return match?.[1] ? match[1].trim() : null;
}

function estimateDeadlineDays(etaText: string | null) {
  if (!etaText) {
    return '30';
  }

  const normalized = etaText.toLowerCase();
  const monthMatch = normalized.match(/(\d+)\s*month/);
  if (monthMatch?.[1]) {
    return String(Number.parseInt(monthMatch[1], 10) * 30);
  }

  const weekMatch = normalized.match(/(\d+)\s*week/);
  if (weekMatch?.[1]) {
    return String(Number.parseInt(weekMatch[1], 10) * 7);
  }

  const dayMatch = normalized.match(/(\d+)\s*day/);
  if (dayMatch?.[1]) {
    return String(Number.parseInt(dayMatch[1], 10));
  }

  return '30';
}

function parseBudgetBreakdown(budgetSection: string) {
  const lines = sectionLines(budgetSection);
  const entries: Array<{ label: string; amount: string }> = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index];
    const amount = lines[index + 1];

    if (!amount || !/^\$\s?[\d,.]+/.test(amount)) {
      continue;
    }

    if (/^amount$/i.test(label) || /^milestone$/i.test(label) || /^item$/i.test(label)) {
      continue;
    }

    entries.push({
      label,
      amount: amount.replace(/\s+/g, ' ').trim(),
    });
    index += 1;
  }

  return entries;
}

function extractMilestoneBlocks(deliverablesSection: string) {
  const normalized = deliverablesSection.replace(/\r/g, '');
  const matches = normalized.matchAll(
    /(Milestone\s+(\d+)\s*:\s*[^\n]+)([\s\S]*?)(?=Milestone\s+\d+\s*:|Post-Grant Maintenance Schedule|$)/gi,
  );

  return Array.from(matches).map((match) => {
    const heading = normalizeWhitespace(match[1] || '');
    const index = Number.parseInt(match[2] || '', 10);
    const body = (match[3] || '').trim();
    const titleMatch = heading.match(/Milestone\s+\d+\s*:\s*(.+?)(?:\s*\((?:Month|Week)[^)]+\))?(?:\s*[—-]\s*([\d.]+%) of grant)?$/i);
    const title = normalizeWhitespace(titleMatch?.[1] || heading.replace(/^Milestone\s+\d+\s*:\s*/i, ''));
    const budgetPercent = titleMatch?.[2] ? normalizeWhitespace(titleMatch[2]) : null;

    return {
      index,
      title,
      budgetPercent,
      description: body.trim(),
    };
  }).filter((entry) => Number.isFinite(entry.index));
}

function buildMilestoneDescription(params: {
  title: string;
  description: string;
  budgetAmountUsd: string | null;
  budgetPercent: string | null;
  kind: ImportedGrantMilestoneKind;
}) {
  const parts = [params.description.trim()];
  const budgetParts = [params.budgetAmountUsd, params.budgetPercent].filter(Boolean);
  if (budgetParts.length) {
    parts.push(`Source budget reference: ${budgetParts.join(' · ')}.`);
  }

  if (params.kind === 'COMMENCEMENT') {
    parts.push(
      'This imported kickoff release represents the source thread’s upfront commencement payment before the main delivery milestones begin.'
    );
  }

  return truncate(parts.filter(Boolean).join('\n\n'), 1000);
}

function pickFirstPost(topic: DiscourseTopicPayload) {
  const posts = Array.isArray(topic.post_stream?.posts) ? topic.post_stream?.posts : [];
  return (posts || [])[0] || null;
}

function buildThreadText(post: DiscourseTopicPost | null) {
  if (!post?.cooked) {
    return '';
  }

  return discourseCookedHtmlToText(post.cooked);
}

function buildBountyDescription(summary: string, benefits: string, currentStatus: string) {
  return truncate(
    [summary, benefits ? `Key benefits:\n${benefits}` : '', currentStatus ? `Current status:\n${currentStatus}` : '']
      .filter(Boolean)
      .join('\n\n'),
    4000,
  );
}

function buildGovernanceNotes(params: {
  votPageUrl: string | null;
  grantAmountRequested: string | null;
  etaToCompletion: string | null;
  fundingAddress: string | null;
  outOfScope: string;
  riskMitigation: string;
  topicLastPostedAt: string | null;
}) {
  const parts = [
    params.votPageUrl ? `VOT page: ${params.votPageUrl}` : '',
    params.grantAmountRequested ? `Requested amount: ${params.grantAmountRequested}` : '',
    params.etaToCompletion ? `ETA from source thread: ${params.etaToCompletion}` : '',
    params.fundingAddress ? `Funding address from source thread: ${params.fundingAddress}` : '',
    params.topicLastPostedAt ? `Forum thread last activity: ${params.topicLastPostedAt}` : '',
    params.outOfScope ? `Out of scope:\n${params.outOfScope}` : '',
    params.riskMitigation ? `Risk and mitigation:\n${params.riskMitigation}` : '',
  ].filter(Boolean);

  return truncate(parts.join('\n\n'), 2000);
}

function buildImportedMilestones(params: {
  deliverablesSection: string;
  budgetBreakdown: Array<{ label: string; amount: string }>;
  upfrontPercentage: string | null;
  upfrontAmountUsd: string | null;
}) {
  const milestones = extractMilestoneBlocks(params.deliverablesSection);
  const budgetByMilestoneIndex = new Map<number, string>();

  for (const entry of params.budgetBreakdown) {
    const milestoneMatch = entry.label.match(/^Milestone\s+(\d+)\s*:/i);
    if (milestoneMatch?.[1]) {
      budgetByMilestoneIndex.set(Number.parseInt(milestoneMatch[1], 10), entry.amount);
    }
  }

  const drafts: ImportedGrantMilestoneDraft[] = [];
  if (params.upfrontPercentage || params.upfrontAmountUsd) {
    const budgetLabel = [params.upfrontAmountUsd, params.upfrontPercentage].filter(Boolean).join(' · ');
    drafts.push({
      title: 'Grant Commencement',
      description: buildMilestoneDescription({
        title: 'Grant Commencement',
        description:
          'Kickoff release tied to grant commencement before the numbered delivery milestones begin. Reviewers can use this checkpoint for sponsor acceptance, setup confirmation, or any start-of-grant prerequisites.',
        budgetAmountUsd: params.upfrontAmountUsd,
        budgetPercent: params.upfrontPercentage,
        kind: 'COMMENCEMENT',
      }),
      amountCkb: '',
      sourceBudgetLabel: budgetLabel || undefined,
      kind: 'COMMENCEMENT',
    });
  }

  for (const milestone of milestones) {
    const amountUsd = budgetByMilestoneIndex.get(milestone.index) || null;
    const sourceBudgetLabel = [amountUsd, milestone.budgetPercent].filter(Boolean).join(' · ');
    drafts.push({
      title: milestone.title,
      description: buildMilestoneDescription({
        title: milestone.title,
        description: milestone.description,
        budgetAmountUsd: amountUsd,
        budgetPercent: milestone.budgetPercent,
        kind: 'DELIVERABLE',
      }),
      amountCkb: '',
      sourceBudgetLabel: sourceBudgetLabel || undefined,
      kind: 'DELIVERABLE',
    });
  }

  return drafts;
}

function inferUpfrontPayment(deliverablesSection: string, budgetBreakdown: Array<{ label: string; amount: string }>) {
  const upfrontFromText = normalizeWhitespace(deliverablesSection).match(/initial\s+([\d.]+%)\s+down payment/i);
  const commencementEntry = budgetBreakdown.find((entry) => /grant commencement/i.test(entry.label));
  const commencementPercent = commencementEntry?.label.match(/\(([\d.]+%)\)/)?.[1] || null;

  return {
    percentage: commencementPercent || upfrontFromText?.[1] || null,
    amountUsd: commencementEntry?.amount || null,
    label: commencementEntry?.label || null,
  };
}

function buildSourceMetadata(params: {
  threadUrl: string;
  topic: DiscourseTopicPayload;
  firstPost: DiscourseTopicPost | null;
  summary: string;
  projectIntroduction: string;
  currentStatus: string;
  applicationDesign: string;
  keyBenefits: string;
  outOfScope: string;
  riskMitigation: string;
  grantAmountRequested: string | null;
  etaToCompletion: string | null;
  fundingAddress: string | null;
  votPageUrl: string | null;
  upfrontPayment: {
    percentage: string | null;
    amountUsd: string | null;
    label: string | null;
  };
  budgetBreakdown: Array<{ label: string; amount: string }>;
  milestones: ImportedGrantMilestoneDraft[];
}) {
  const missingFields = [
    !params.grantAmountRequested ? 'grantAmountRequested' : null,
    !params.etaToCompletion ? 'etaToCompletion' : null,
    !params.fundingAddress ? 'fundingAddress' : null,
  ].filter(Boolean) as string[];

  return {
    provider: 'DISCOURSE',
    parser: 'NERVOS_GRANT_THREAD_V1',
    sourceKind: 'NERVOS_GRANT_THREAD',
    threadUrl: params.threadUrl,
    topicId: typeof params.topic.id === 'number' ? params.topic.id : null,
    topicTitle: params.topic.title || '',
    topicAuthor: params.firstPost?.username || null,
    topicCreatedAt: params.firstPost?.created_at || null,
    topicLastPostedAt: params.topic.last_posted_at || null,
    postsCount: typeof params.topic.posts_count === 'number' ? params.topic.posts_count : 0,
    tags: Array.isArray(params.topic.tags) ? params.topic.tags : [],
    votPageUrl: params.votPageUrl,
    grantAmountRequested: params.grantAmountRequested,
    etaToCompletion: params.etaToCompletion,
    fundingAddress: params.fundingAddress,
    summary: params.summary,
    projectIntroduction: params.projectIntroduction,
    currentStatus: params.currentStatus,
    applicationDesign: params.applicationDesign,
    keyBenefits: params.keyBenefits,
    outOfScope: params.outOfScope,
    riskMitigation: params.riskMitigation,
    upfrontPayment: params.upfrontPayment,
    milestones: params.milestones.map((milestone, index) => ({
      index,
      title: milestone.title,
      description: milestone.description,
      budgetAmountUsd: milestone.sourceBudgetLabel?.split(' · ')[0] || null,
      budgetPercent:
        milestone.sourceBudgetLabel?.split(' · ').find((item) => /%/.test(item)) || null,
      kind: milestone.kind,
    })),
    rawBudgetBreakdown: params.budgetBreakdown,
    sourceLastSyncedAt: new Date().toISOString(),
    missingFields,
  } satisfies NervosGrantSourceMetadata;
}

export function buildNervosGrantAutofillFromTopic(
  threadUrl: string,
  topic: DiscourseTopicPayload,
): NervosGrantAutofillResult {
  const normalizedUrl = threadUrl.trim();
  const discourseTarget = parseDiscourseTopicTarget(normalizedUrl);
  if (!discourseTarget) {
    throw new Error('Paste a supported Nervos forum thread URL so PactAgent can auto-fill the grant.');
  }

  const firstPost = pickFirstPost(topic);
  const text = buildThreadText(firstPost);
  if (!text) {
    throw new Error('The forum thread did not include a readable first post for import.');
  }

  const lines = sectionLines(text);
  const summary = collectSection(lines, /^1\.\s*summary\b/i, [/^2\.\s*project introduction\b/i]);
  const projectIntroduction = collectSection(lines, /^2\.\s*project introduction\b/i, [/^3\.\s*team\b/i]);
  const currentStatus = collectSection(lines, /^4\.\s*current status\b/i, [/^5\.\s*application design\b/i]);
  const applicationDesign = collectSection(lines, /^5\.\s*application design\b/i, [/^6\.\s*key benefits\b/i]);
  const keyBenefits = collectSection(lines, /^6\.\s*key benefits\b/i, [/^7\.\s*detailed deliverables\b/i]);
  const deliverablesSection = collectSection(lines, /^7\.\s*detailed deliverables\b/i, [/^8\.\s*budget breakdown\b/i, /^9\.\s*budget breakdown\b/i, /^10\.\s*out-of-scope\b/i]);
  const budgetSection = collectSection(lines, /^8\.\s*budget breakdown\b/i, [/^9\.\s*out-of-scope\b/i, /^10\.\s*out-of-scope\b/i, /^11\.\s*risk\b/i]);
  const outOfScope = collectSection(lines, /^10\.\s*out-of-scope\b/i, [/^11\.\s*risk\b/i, /^12\.\s*closing\b/i, /^13\.\s*\(optional\)\s*supporting links\b/i]);
  const riskMitigation = collectSection(lines, /^11\.\s*risk\b/i, [/^12\.\s*closing\b/i, /^13\.\s*\(optional\)\s*supporting links\b/i]);

  const grantAmountRequested = extractLabeledValue(summary, 'Grant Amount Requested');
  const etaToCompletion = extractLabeledValue(summary, 'ETA to Completion');
  const fundingAddress = extractLabeledValue(summary, 'CKB Wallet / Funding Address')
    || extractLabeledValue(summary, 'CKB Wallet or Funding Address');
  const votPageUrl = extractUrl(text, 'Link to VOT page');
  const budgetBreakdown = parseBudgetBreakdown(budgetSection);
  const upfrontPayment = inferUpfrontPayment(deliverablesSection, budgetBreakdown);
  const milestones = buildImportedMilestones({
    deliverablesSection,
    budgetBreakdown,
    upfrontPercentage: upfrontPayment.percentage,
    upfrontAmountUsd: upfrontPayment.amountUsd,
  });

  const cleanedTitle = stripDiscussionPrefix(topic.title || 'Imported Nervos grant');
  const agreementTitle = `${cleanedTitle} Grant Delivery Agreement`;
  const bountyDescription = buildBountyDescription(summary, keyBenefits, currentStatus);
  const governanceNotes = buildGovernanceNotes({
    votPageUrl,
    grantAmountRequested,
    etaToCompletion,
    fundingAddress,
    outOfScope,
    riskMitigation,
    topicLastPostedAt: topic.last_posted_at || null,
  });
  const agreementDescription = truncate(
    [
      summary,
      deliverablesSection
        ? 'Imported source milestones were converted into PactAgent payout checkpoints. Enter the final CKB release amounts manually because the forum source expresses budget in USD.'
        : '',
      keyBenefits ? `CKB ecosystem impact:\n${keyBenefits}` : '',
    ].filter(Boolean).join('\n\n'),
    4000,
  );

  const sourceMetadata = buildSourceMetadata({
    threadUrl: normalizedUrl,
    topic,
    firstPost,
    summary,
    projectIntroduction,
    currentStatus,
    applicationDesign,
    keyBenefits,
    outOfScope,
    riskMitigation,
    grantAmountRequested,
    etaToCompletion,
    fundingAddress,
    votPageUrl,
    upfrontPayment,
    budgetBreakdown,
    milestones,
  });

  const sourceLabel = votPageUrl ? 'CKB Community Fund DAO' : 'Nervos Community Grant';

  return {
    sourceType: 'DAO',
    sourceLabel,
    externalUrl: normalizedUrl,
    forumThreadUrl: normalizedUrl,
    sourceReferenceId: discourseTarget.topicId ? String(discourseTarget.topicId) : undefined,
    sponsorName: votPageUrl ? 'CKB Community Fund DAO' : undefined,
    bountyTitle: cleanedTitle,
    bountyDescription,
    governanceNotes,
    agreementTitle,
    agreementDescription,
    deadlineDays: estimateDeadlineDays(etaToCompletion),
    milestones,
    sourceMetadata,
  };
}

export async function resolveNervosGrantAutofill(threadUrl: string): Promise<NervosGrantAutofillResult> {
  const normalizedUrl = threadUrl.trim();
  const topic = await fetchDiscourseTopicJson(normalizedUrl, config.forumPublishTimeoutMs);
  return buildNervosGrantAutofillFromTopic(normalizedUrl, topic);
}
