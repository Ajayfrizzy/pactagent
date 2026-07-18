import type { Request, Response } from 'express';
import { sendList } from '../../common/middleware/response';
import * as reviewService from './review.service';

export async function listReviews(req: Request, res: Response) {
  const result = await reviewService.listReviewsForApp(req.apiKey!.appId, req.query as any);
  return sendList(res, result.data, result.pagination);
}
