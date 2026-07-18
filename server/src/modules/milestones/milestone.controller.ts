import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as milestoneService from './milestone.service';

function currentAppId(req: Request) {
  return req.apiKey!.appId;
}

export async function createMilestone(req: Request, res: Response) {
  const milestone = await milestoneService.createMilestoneForAgreement(
    req,
    currentAppId(req),
    req.params.id,
    req.body,
  );
  return sendSuccess(res, milestone, 201);
}

export async function listMilestones(req: Request, res: Response) {
  const result = await milestoneService.listMilestonesForAgreement(
    currentAppId(req),
    req.params.id,
    req.query as any,
  );
  return sendList(res, result.data, result.pagination);
}

export async function listAppMilestones(req: Request, res: Response) {
  const result = await milestoneService.listMilestonesForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getMilestone(req: Request, res: Response) {
  const milestone = await milestoneService.getMilestoneForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, milestone);
}
