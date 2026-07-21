import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as eventService from './event.service';

function currentAppId(req: Request) {
  return req.tenant!.appId;
}

export async function listEvents(req: Request, res: Response) {
  const result = await eventService.listAppEvents(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getEvent(req: Request, res: Response) {
  const event = await eventService.getAppEvent(currentAppId(req), req.params.id);
  return sendSuccess(res, event);
}
