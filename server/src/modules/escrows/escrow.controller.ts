import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as escrowService from './escrow.service';

function currentAppId(req: Request) {
  return req.apiKey!.appId;
}

export async function createEscrow(req: Request, res: Response) {
  const escrow = await escrowService.createEscrowForApp(req, currentAppId(req), req.body);
  return sendSuccess(res, escrow, 201);
}

export async function listEscrows(req: Request, res: Response) {
  const result = await escrowService.listEscrowsForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getEscrow(req: Request, res: Response) {
  const escrow = await escrowService.getEscrowForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, escrow);
}

export async function markEscrowFunded(req: Request, res: Response) {
  const escrow = await escrowService.markEscrowFunded(req, currentAppId(req), req.params.id, req.body);
  return sendSuccess(res, escrow);
}

export async function releaseEscrow(req: Request, res: Response) {
  const escrow = await escrowService.releaseEscrow(req, currentAppId(req), req.params.id);
  return sendSuccess(res, escrow);
}

export async function refundEscrow(req: Request, res: Response) {
  const escrow = await escrowService.refundEscrow(req, currentAppId(req), req.params.id);
  return sendSuccess(res, escrow);
}
