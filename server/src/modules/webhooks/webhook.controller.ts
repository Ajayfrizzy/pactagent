import type { Request, Response } from 'express';
import { sendList, sendSuccess } from '../../common/middleware/response';
import * as webhookService from './webhook.service';

function currentApp(req: Request) {
  return req.currentApp!;
}

function currentAppId(req: Request) {
  return req.tenant!.appId;
}

export async function createWebhookEndpoint(req: Request, res: Response) {
  const endpoint = await webhookService.createWebhookEndpointForApp(req, currentApp(req), req.body);
  return sendSuccess(res, endpoint, 201);
}

export async function listWebhookEndpoints(req: Request, res: Response) {
  const result = await webhookService.listWebhookEndpointsForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getWebhookEndpoint(req: Request, res: Response) {
  const endpoint = await webhookService.getWebhookEndpointForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, endpoint);
}

export async function updateWebhookEndpoint(req: Request, res: Response) {
  const endpoint = await webhookService.updateWebhookEndpointForApp(req, currentApp(req), req.params.id, req.body);
  return sendSuccess(res, endpoint);
}

export async function deleteWebhookEndpoint(req: Request, res: Response) {
  const endpoint = await webhookService.deleteWebhookEndpointForApp(req, currentAppId(req), req.params.id);
  return sendSuccess(res, endpoint);
}

export async function listWebhookDeliveries(req: Request, res: Response) {
  const result = await webhookService.listWebhookDeliveriesForApp(currentAppId(req), req.query as any);
  return sendList(res, result.data, result.pagination);
}

export async function getWebhookDelivery(req: Request, res: Response) {
  const delivery = await webhookService.getWebhookDeliveryForApp(currentAppId(req), req.params.id);
  return sendSuccess(res, delivery);
}

export async function retryWebhookDelivery(req: Request, res: Response) {
  const delivery = await webhookService.retryWebhookDeliveryForApp(req, currentAppId(req), req.params.id);
  return sendSuccess(res, delivery);
}
