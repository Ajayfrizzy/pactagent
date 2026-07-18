import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as disputeService from './dispute.service';

function currentAppId(req: Request) {
  return req.apiKey!.appId;
}

export async function createDispute(req: Request, res: Response) {
  const dispute = await disputeService.createDisputeForApp(req, currentAppId(req), req.body);
  return sendSuccess(res, dispute, 201);
}

export async function listDisputes(req: Request, res: Response) {
  const result = await disputeService.listDisputesForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getDispute(req: Request, res: Response) {
  const dispute = await disputeService.getDisputeForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, dispute);
}

export async function resolveDispute(req: Request, res: Response) {
  const dispute = await disputeService.resolveDisputeForApp(req, currentAppId(req), req.params.id, req.body);
  return sendSuccess(res, dispute);
}
