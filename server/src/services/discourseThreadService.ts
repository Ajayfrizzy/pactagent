import { assertProviderResponse, executeProviderRequest } from '../common/resilience/provider';

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export type DiscourseTopicTarget = {
  apiBaseUrl: string;
  topicId: number;
  topicUrl: string;
};

export type DiscourseTopicPost = {
  id?: number;
  post_number?: number;
  username?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  cooked?: string;
  raw?: string;
};

export type DiscourseTopicPayload = {
  id?: number;
  slug?: string;
  title?: string;
  posts_count?: number;
  last_posted_at?: string;
  tags?: string[];
  post_stream?: {
    posts?: DiscourseTopicPost[];
  };
  details?: {
    links?: Array<{
      url?: string;
      title?: string | null;
    }>;
  };
};

export function parseDiscourseTopicTarget(threadUrl: string): DiscourseTopicTarget | null {
  try {
    const parsed = new URL(threadUrl);
    const match =
      parsed.pathname.match(/\/t\/[^/]+\/(\d+)(?:\/\d+)?\/?$/i)
      || parsed.pathname.match(/\/t\/(\d+)(?:\/\d+)?\/?$/i);
    const topicId = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;

    if (!Number.isFinite(topicId)) {
      return null;
    }

    return {
      apiBaseUrl: parsed.origin,
      topicId,
      topicUrl: parsed.toString(),
    };
  } catch {
    return null;
  }
}

export function discourseCookedHtmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

export async function fetchDiscourseTopicJson(threadUrl: string, timeoutMs = 10_000) {
  const target = parseDiscourseTopicTarget(threadUrl);
  if (!target) {
    throw new Error('The source thread URL is not a supported Discourse topic URL.');
  }

  const response = await executeProviderRequest({
    provider: 'forum', operation: 'read-topic', timeoutMs, maxAttempts: 3, concurrency: 5,
    run: async ({ signal, requestId }) => {
      const result = await fetch(`${target.apiBaseUrl}/t/${target.topicId}.json`, {
        headers: { 'User-Agent': 'PactAgent SourceSync/1.0', Accept: 'application/json', 'x-request-id': requestId },
        signal,
      });
      assertProviderResponse(result, 'forum', requestId);
      return result;
    },
  });

  return response.json() as Promise<DiscourseTopicPayload>;
}

export function summarizeDiscourseTopicJson(url: string, topic: DiscourseTopicPayload) {
  const posts = Array.isArray(topic.post_stream?.posts) ? topic.post_stream.posts : [];
  const latestPost = posts.reduce<DiscourseTopicPost | null>((latest, post) => {
    if (!latest) {
      return post;
    }

    return (post.post_number || 0) > (latest.post_number || 0) ? post : latest;
  }, null);
  const latestExcerpt = latestPost?.cooked ? truncate(discourseCookedHtmlToText(latestPost.cooked), 420) : '';

  const parts = [
    topic.title ? `Thread title: ${normalizeWhitespace(topic.title)}.` : '',
    typeof topic.posts_count === 'number' ? `Posts captured: ${topic.posts_count}.` : '',
    topic.last_posted_at ? `Last activity: ${topic.last_posted_at}.` : '',
    latestExcerpt
      ? `Latest discussion update${latestPost?.username ? ` by ${latestPost.username}` : ''}: ${latestExcerpt}`
      : '',
  ].filter(Boolean);

  return truncate(parts.join(' '), 1200) || `Source thread captured from ${url}.`;
}
