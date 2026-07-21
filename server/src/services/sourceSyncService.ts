import { config } from '../config';
import { prisma } from '../db';
import { createAuditLog } from './auditLogService';
import { assertProviderResponse, executeProviderRequest } from '../common/resilience/provider';
import {
  fetchDiscourseTopicJson,
  parseDiscourseTopicTarget,
  summarizeDiscourseTopicJson,
} from './discourseThreadService';
import { createLog } from './logService';

export const SOURCE_SYNC_STATUSES = [
  'READY_TO_SYNC',
  'SYNCED',
  'DRAFTED',
  'REVIEWED',
  'PUBLISHED',
  'FAILED',
  'NOT_CONFIGURED',
] as const;

export type SourceSyncStatus = (typeof SOURCE_SYNC_STATUSES)[number];

type PublishResult = {
  externalId: string | null;
  publishedUrl: string | null;
  provider: 'DISCOURSE' | 'WEBHOOK';
  rawResponse: Record<string, unknown> | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtml(html: string) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function extractTagContent(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ? normalizeWhitespace(match[1]) : '';
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function summarizeSourceThreadHtml(url: string, html: string) {
  const title = extractTagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    extractTagContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || extractTagContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const excerpt = truncate(stripHtml(html), 420);

  const parts = [
    title ? `Thread title: ${title}.` : '',
    metaDescription ? `Summary: ${metaDescription}.` : '',
    excerpt ? `Latest extracted context: ${excerpt}` : '',
  ].filter(Boolean);

  return truncate(parts.join(' '), 1200) || `Source thread captured from ${url}.`;
}

function buildDiscoursePublishedUrl(topicUrl: string, postNumber: number | null) {
  if (!postNumber) {
    return topicUrl;
  }

  const trimmed = topicUrl.replace(/\/+$/, '');
  return `${trimmed}/${postNumber}`;
}

async function publishToDiscourse(params: {
  threadUrl: string;
  raw: string;
}): Promise<PublishResult> {
  if (!config.forumPublishApiKey || !config.forumPublishApiUsername) {
    throw new Error('Discourse publishing is not fully configured on the server.');
  }

  const target = parseDiscourseTopicTarget(params.threadUrl);
  if (!target) {
    throw new Error('The source thread URL is not a supported Discourse topic URL.');
  }

  const response = await executeProviderRequest({
    provider: 'forum', operation: 'publish_discourse', timeoutMs: config.forumPublishTimeoutMs, maxAttempts: 1,
    run: async ({ signal, requestId }) => {
      const result = await fetch(`${target.apiBaseUrl}/posts.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Api-Key': config.forumPublishApiKey,
          'Api-Username': config.forumPublishApiUsername, 'x-request-id': requestId },
        body: JSON.stringify({ topic_id: target.topicId, raw: params.raw }), signal,
      });
      assertProviderResponse(result, 'forum', requestId);
      return result;
    },
  });

  const responseText = await response.text();
  let parsedResponse: Record<string, unknown> | null = null;
  try {
    parsedResponse = responseText ? JSON.parse(responseText) as Record<string, unknown> : null;
  } catch {
    parsedResponse = null;
  }

  if (!response.ok) {
    throw new Error(
      parsedResponse && typeof parsedResponse.errors === 'object'
        ? `Discourse publish failed with status ${response.status}`
        : responseText || `Discourse publish failed with status ${response.status}`
    );
  }

  const postId =
    parsedResponse && typeof parsedResponse.id === 'number'
      ? String(parsedResponse.id)
      : null;
  const postNumber =
    parsedResponse && typeof parsedResponse.post_number === 'number'
      ? parsedResponse.post_number
      : null;

  return {
    externalId: postId,
    publishedUrl: buildDiscoursePublishedUrl(target.topicUrl, postNumber),
    provider: 'DISCOURSE',
    rawResponse: parsedResponse,
  };
}

async function publishToWebhookRelay(params: {
  agreementId: string;
  threadUrl: string;
  raw: string;
  sourceLabel: string;
}): Promise<PublishResult> {
  if (!config.forumPublishWebhookUrl) {
    throw new Error('Forum publish relay URL is not configured on the server.');
  }

  const response = await executeProviderRequest({
    provider: 'forum', operation: 'publish_relay', timeoutMs: config.forumPublishTimeoutMs, maxAttempts: 1,
    run: async ({ signal, requestId }) => {
      const result = await fetch(config.forumPublishWebhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify({ agreementId: params.agreementId, threadUrl: params.threadUrl,
          sourceLabel: params.sourceLabel, content: params.raw }), signal,
      });
      assertProviderResponse(result, 'forum', requestId);
      return result;
    },
  });

  const responseText = await response.text();
  let parsedResponse: Record<string, unknown> | null = null;
  try {
    parsedResponse = responseText ? JSON.parse(responseText) as Record<string, unknown> : null;
  } catch {
    parsedResponse = null;
  }

  if (!response.ok) {
    throw new Error(responseText || `Forum relay publish failed with status ${response.status}`);
  }

  return {
    externalId:
      parsedResponse && typeof parsedResponse.externalId === 'string'
        ? parsedResponse.externalId
        : null,
    publishedUrl:
      parsedResponse && typeof parsedResponse.publishedUrl === 'string'
        ? parsedResponse.publishedUrl
        : params.threadUrl,
    provider: 'WEBHOOK',
    rawResponse: parsedResponse,
  };
}

async function publishSourceUpdate(params: {
  agreementId: string;
  threadUrl: string;
  raw: string;
  sourceLabel: string;
}) {
  if (!config.forumPublishEnabled) {
    throw new Error('Forum publishing is disabled on this server.');
  }

  if (config.forumPublishProvider === 'WEBHOOK') {
    return publishToWebhookRelay(params);
  }

  return publishToDiscourse({
    threadUrl: params.threadUrl,
    raw: params.raw,
  });
}

async function getAgreementSourceOrThrow(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: { source: true },
  });

  if (!agreement) {
    throw new Error('Agreement not found');
  }

  if (!agreement.source) {
    throw new Error('This agreement does not have imported source metadata');
  }

  return agreement;
}

export async function syncAgreementSource(params: {
  agreementId: string;
  actorAddress?: string | null;
  forumThreadUrl?: string;
  manualSummary?: string | null;
  actorType?: 'USER' | 'SYSTEM';
  emitAudit?: boolean;
}) {
  const agreement = await getAgreementSourceOrThrow(params.agreementId);
  const sourceRecord = agreement.source;

  if (!sourceRecord) {
    throw new Error('This agreement does not have imported source metadata');
  }

  const nextThreadUrl =
    params.forumThreadUrl?.trim()
    || sourceRecord.forumThreadUrl
    || sourceRecord.externalUrl;

    if (!nextThreadUrl) {
      const source = await prisma.agreementSource.update({
        where: { agreementId: agreement.id },
      data: {
        syncStatus: 'NOT_CONFIGURED',
      },
    });

      await createLog({
        agreementId: agreement.id,
        level: 'WARN',
      eventType: 'SOURCE_SYNC_SKIPPED',
      message: 'Source sync skipped because no source thread URL is configured.',
      metadata: {
        agreementId: agreement.id,
      },
      });

      if (params.emitAudit) {
        await createAuditLog({
          agreementId: agreement.id,
          actorAddress: params.actorAddress ?? null,
          actorType: params.actorType || 'SYSTEM',
          action: 'SOURCE_SYNC_FAILED',
          resourceType: 'SOURCE',
          resourceId: source.id,
          metadata: {
            error: 'No source thread URL is configured.',
          },
        });
      }

      return source;
    }

  try {
    let latestSummary = params.manualSummary?.trim() || '';

    if (!latestSummary) {
      const discourseTarget = parseDiscourseTopicTarget(nextThreadUrl);
      if (discourseTarget) {
        const topic = await fetchDiscourseTopicJson(nextThreadUrl, config.forumPublishTimeoutMs);
        latestSummary = summarizeDiscourseTopicJson(nextThreadUrl, topic);
      } else {
        const response = await executeProviderRequest({
          provider: 'forum', operation: 'read-thread', timeoutMs: config.forumPublishTimeoutMs, maxAttempts: 3, concurrency: 5,
          run: async ({ signal, requestId }) => {
            const result = await fetch(nextThreadUrl, {
              headers: { 'User-Agent': 'PactAgent SourceSync/1.0', Accept: 'text/html,application/xhtml+xml', 'x-request-id': requestId },
              signal,
            });
            assertProviderResponse(result, 'forum', requestId);
            return result;
          },
        });

        const html = await response.text();
        latestSummary = summarizeSourceThreadHtml(nextThreadUrl, html);
      }
    }

    const source = await prisma.agreementSource.update({
      where: { agreementId: agreement.id },
      data: {
        forumThreadUrl: nextThreadUrl,
        latestSummary,
        lastSyncedAt: new Date(),
        syncStatus: 'SYNCED',
      },
    });

    await createLog({
      agreementId: agreement.id,
      level: 'SUCCESS',
      eventType: 'SOURCE_SYNC_UPDATED',
      message: 'Imported grant source thread synced successfully.',
      metadata: {
        agreementId: agreement.id,
        forumThreadUrl: nextThreadUrl,
        summaryPreview: latestSummary.slice(0, 240),
      },
    });

    if (params.emitAudit) {
      await createAuditLog({
        agreementId: agreement.id,
        actorAddress: params.actorAddress ?? null,
        actorType: params.actorType || 'SYSTEM',
        action: 'SOURCE_SYNC_COMPLETED',
        resourceType: 'SOURCE',
        resourceId: source.id,
        metadata: {
          forumThreadUrl: source.forumThreadUrl,
          syncStatus: source.syncStatus,
          lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
          latestSummary: source.latestSummary,
        },
      });
    }

    if (typeof agreement.id === 'string') {
      const { broadcastAgreementUpdateById } = await import('./agreementService');
      await broadcastAgreementUpdateById(agreement.id);
    }

    return source;
  } catch (error) {
    const failedSource = await prisma.agreementSource.update({
      where: { agreementId: agreement.id },
      data: {
        forumThreadUrl: nextThreadUrl,
        lastSyncedAt: new Date(),
        syncStatus: 'FAILED',
      },
    });

    await createLog({
      agreementId: agreement.id,
      level: 'ERROR',
      eventType: 'SOURCE_SYNC_FAILED',
      message: 'Imported grant source sync failed.',
      metadata: {
        agreementId: agreement.id,
        forumThreadUrl: nextThreadUrl,
        error: error instanceof Error ? error.message : 'Unknown source sync error',
      },
    });

    if (params.emitAudit) {
      await createAuditLog({
        agreementId: agreement.id,
        actorAddress: params.actorAddress ?? null,
        actorType: params.actorType || 'SYSTEM',
        action: 'SOURCE_SYNC_FAILED',
        resourceType: 'SOURCE',
        resourceId: failedSource.id,
        metadata: {
          forumThreadUrl: nextThreadUrl,
          error: error instanceof Error ? error.message : 'Unknown source sync error',
        },
      });
    }

    throw error;
  }
}

export async function saveSourceSyncDraft(params: {
  agreementId: string;
  content: string;
}) {
  const agreement = await getAgreementSourceOrThrow(params.agreementId);
  const source = await prisma.agreementSource.update({
    where: { agreementId: agreement.id },
    data: {
      draftUpdate: params.content.trim(),
      syncStatus: 'DRAFTED',
    },
  });

  await createLog({
    agreementId: agreement.id,
    level: 'INFO',
    eventType: 'SOURCE_SYNC_DRAFTED',
    message: 'Source thread update drafted for reviewer approval.',
    metadata: {
      agreementId: agreement.id,
      draftPreview: params.content.trim().slice(0, 240),
    },
  });

  return source;
}

export async function publishSourceSyncUpdate(params: {
  agreementId: string;
  content: string;
  reviewerApproved: boolean;
  reviewerAddress?: string | null;
}) {
  if (!params.reviewerApproved) {
    throw new Error('Reviewer approval is required before publishing a source update.');
  }

  const agreement = await getAgreementSourceOrThrow(params.agreementId);
  const sourceRecord = agreement.source;

  if (!sourceRecord) {
    throw new Error('This agreement does not have imported source metadata');
  }

  if (!sourceRecord.reviewedAt || !sourceRecord.reviewedByAddress) {
    throw new Error('A reviewed source draft is required before publishing.');
  }

  if (params.reviewerAddress && sourceRecord.reviewedByAddress !== params.reviewerAddress) {
    throw new Error('The publishing reviewer must match the address that marked this source update as reviewed.');
  }

  const threadUrl = sourceRecord.forumThreadUrl || sourceRecord.externalUrl;
  if (!threadUrl) {
    throw new Error('No source thread URL is configured for this agreement.');
  }

  try {
    const publishResult = await publishSourceUpdate({
      agreementId: agreement.id,
      threadUrl,
      raw: params.content.trim(),
      sourceLabel: sourceRecord.sourceLabel,
    });

    const source = await prisma.agreementSource.update({
      where: { agreementId: agreement.id },
      data: {
        draftUpdate: params.content.trim(),
        syncStatus: 'PUBLISHED',
        lastPublishedAt: new Date(),
        lastPublishedUrl: publishResult.publishedUrl,
        lastPublishedExternalId: publishResult.externalId,
        lastPublishError: null,
      },
    });

    await createLog({
      agreementId: agreement.id,
      level: 'SUCCESS',
      eventType: 'SOURCE_SYNC_PUBLISHED',
      message: 'Source thread update was published after reviewer approval.',
      metadata: {
        agreementId: agreement.id,
        publishMode: 'DIRECT_POST',
        provider: publishResult.provider,
        publishedPreview: params.content.trim().slice(0, 240),
        publishedUrl: publishResult.publishedUrl,
        externalId: publishResult.externalId,
      },
    });

    return source;
  } catch (error) {
    await prisma.agreementSource.update({
      where: { agreementId: agreement.id },
      data: {
        draftUpdate: params.content.trim(),
        syncStatus: 'FAILED',
        lastPublishError: error instanceof Error ? error.message : 'Unknown source publish error',
      },
    });

    await createLog({
      agreementId: agreement.id,
      level: 'ERROR',
      eventType: 'SOURCE_SYNC_PUBLISH_FAILED',
      message: 'Source thread publish failed.',
      metadata: {
        agreementId: agreement.id,
        threadUrl,
        error: error instanceof Error ? error.message : 'Unknown source publish error',
      },
    });

    throw error;
  }
}

export async function markSourceSyncReviewed(params: {
  agreementId: string;
  reviewerAddress: string;
}) {
  const agreement = await getAgreementSourceOrThrow(params.agreementId);
  const source = await prisma.agreementSource.update({
    where: { agreementId: agreement.id },
    data: {
      syncStatus: 'REVIEWED',
      reviewedAt: new Date(),
      reviewedByAddress: params.reviewerAddress,
    },
  });

  await createLog({
    agreementId: agreement.id,
    level: 'INFO',
    eventType: 'SOURCE_SYNC_REVIEWED',
    message: 'Source thread update reviewed and marked ready for publication.',
    metadata: {
      agreementId: agreement.id,
      reviewerAddress: params.reviewerAddress,
    },
  });

  return source;
}

export async function listSourceSyncCandidates(limit = 25) {
  return prisma.agreementSource.findMany({
    where: {
      forumThreadUrl: {
        not: null,
      },
      syncStatus: {
        not: 'NOT_CONFIGURED',
      },
    },
    orderBy: [
      { lastSyncedAt: 'asc' },
      { updatedAt: 'asc' },
    ],
    take: limit,
  });
}
