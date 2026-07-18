import type { Request, Response } from 'express';
import { sendList } from '../../common/middleware/response';
import * as transactionService from './transaction.service';

export async function listTransactions(req: Request, res: Response) {
  const result = await transactionService.listAppTransactions(req.apiKey!.appId, req.query as any);
  return sendList(res, result.data, result.pagination);
}
