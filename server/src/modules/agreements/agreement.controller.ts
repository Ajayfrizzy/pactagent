import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as agreementService from './agreement.service';

function currentAppId(req: Request) {
  return req.apiKey!.appId;
}

export async function createAgreement(req: Request, res: Response) {
  const agreement = await agreementService.createAgreementForApp(req, currentAppId(req), req.body);
  return sendSuccess(res, agreement, 201);
}

export async function listAgreements(req: Request, res: Response) {
  const result = await agreementService.listAgreementsForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getAgreement(req: Request, res: Response) {
  const agreement = await agreementService.getAgreementForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, agreement);
}

export async function acceptAgreement(req: Request, res: Response) {
  const agreement = await agreementService.acceptAgreement(req, currentAppId(req), req.params.id);
  return sendSuccess(res, agreement);
}

export async function cancelAgreement(req: Request, res: Response) {
  const agreement = await agreementService.cancelAgreement(req, currentAppId(req), req.params.id);
  return sendSuccess(res, agreement);
}

export async function moveAgreementToFundingRequired(req: Request, res: Response) {
  const agreement = await agreementService.moveAgreementToFundingRequired(req, currentAppId(req), req.params.id);
  return sendSuccess(res, agreement);
}
