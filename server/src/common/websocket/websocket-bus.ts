import { randomUUID } from 'crypto';
import { createClient, type RedisClientType } from 'redis';
import { config } from '../../config';
import { log } from '../observability/logger';

const CHANNEL = 'pactagent:websocket:events';
const instanceId = randomUUID();
let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

async function connectedClient() {
  const client = createClient({ url: config.redisUrl }) as RedisClientType;
  client.on('error', (error) => log('error', 'websocket.redis.error', { error }));
  await client.connect();
  return client;
}

export async function subscribeWebSocketEvents(handler: (event: unknown) => void) {
  if (!config.redisUrl || subscriber) return;
  subscriber = await connectedClient();
  await subscriber.subscribe(CHANNEL, (raw) => {
    try {
      const message = JSON.parse(raw) as { origin: string; event: unknown };
      if (message.origin !== instanceId) handler(message.event);
    } catch (error) {
      log('warn', 'websocket.redis.invalid_message', { error });
    }
  });
}

export async function publishWebSocketEvent(event: unknown) {
  if (!config.redisUrl) return;
  publisher ??= await connectedClient();
  await publisher.publish(CHANNEL, JSON.stringify({ origin: instanceId, event }));
}

export async function closeWebSocketBus() {
  const clients = [subscriber, publisher].filter((client): client is RedisClientType => Boolean(client));
  subscriber = null;
  publisher = null;
  await Promise.all(clients.map(async (client) => {
    if (client.isOpen) await client.quit();
  }));
}
