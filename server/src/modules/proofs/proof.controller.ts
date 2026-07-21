import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as proofService from './proof.service';

function currentAppId(req: Request) {
  return req.tenant!.appId;
}

export async function createProof(req: Request, res: Response) {
  const proof = await proofService.createProofForApp(req, currentAppId(req), req.body);
  return sendSuccess(res, proof, 201);
}

export async function listProofs(req: Request, res: Response) {
  const result = await proofService.listProofsForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getProof(req: Request, res: Response) {
  const proof = await proofService.getProofForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, proof);
}

export async function reviewProof(req: Request, res: Response) {
  const result = await proofService.reviewProofForApp(req, currentAppId(req), req.params.id, req.body);
  return sendSuccess(res, result);
}
