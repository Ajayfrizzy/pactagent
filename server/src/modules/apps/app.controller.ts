import type { Request, Response } from 'express';
import { authenticationError } from '../../common/errors/app-error';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as appService from './app.service';

function requireOwner(req: Request) {
  if (!req.auth?.address) {
    throw authenticationError();
  }

  return req.auth.address;
}

export async function createApp(req: Request, res: Response) {
  const app = await appService.createAppForOwner(req, requireOwner(req), req.body);
  return sendSuccess(res, app, 201);
}

export async function listApps(req: Request, res: Response) {
  const result = await appService.listAppsForOwner(requireOwner(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getApp(req: Request, res: Response) {
  const app = await appService.getAppForOwner(requireOwner(req), req.params.id);
  return sendSuccess(res, app);
}

export async function updateApp(req: Request, res: Response) {
  const app = await appService.updateAppForOwner(req, requireOwner(req), req.params.id, req.body);
  return sendSuccess(res, app);
}

export async function disableApp(req: Request, res: Response) {
  const app = await appService.disableAppForOwner(req, requireOwner(req), req.params.id);
  return sendSuccess(res, app);
}

export async function getCurrentApp(req: Request, res: Response) {
  return sendSuccess(res, appService.getCurrentApiKeyApp(req));
}
