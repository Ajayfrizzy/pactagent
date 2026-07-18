import { deliverWebhookDelivery } from '../modules/webhooks/webhook.service';

export async function runWebhookDeliveryWorker(deliveryId: string) {
  return deliverWebhookDelivery(deliveryId);
}
