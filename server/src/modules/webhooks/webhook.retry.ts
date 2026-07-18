export const WEBHOOK_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
] as const;

export function getWebhookRetryDelayMs(failedAttemptCount: number) {
  if (failedAttemptCount < 1) {
    return WEBHOOK_RETRY_DELAYS_MS[0];
  }

  return WEBHOOK_RETRY_DELAYS_MS[failedAttemptCount - 1] ?? null;
}
