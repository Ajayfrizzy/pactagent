import { serializeReview } from './review.model';
import { tenantContext } from '../../common/tenancy/tenant-context';
import * as reviewRepository from './review.repository';
import type { ReviewListQuery } from './review.validation';

export async function listReviewsForApp(appId: string, query: ReviewListQuery) {
  const reviews = await reviewRepository.listReviewsForApp(tenantContext(appId), query);
  const hasMore = reviews.length > query.limit;
  const data = reviews.slice(0, query.limit);

  return {
    data: data.map(serializeReview),
    pagination: {
      limit: query.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}
