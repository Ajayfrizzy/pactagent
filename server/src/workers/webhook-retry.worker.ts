import { processDueWebhookDeliveries } from '../modules/webhooks/webhook.service';

export async function runWebhookRetryWorker(limit = 25) {
  return processDueWebhookDeliveries(limit);
}
