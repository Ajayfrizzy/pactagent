import { createHash } from 'crypto';
import { createClient } from 'redis';
import { config } from '../config';
import { log } from '../common/observability/logger';

export type AuthChallengeRecord = {
  address: string;
  message: string;
  expiresAt: number;
};

export interface AuthChallengeStore {
  put(record: AuthChallengeRecord, ttlMs: number): Promise<void>;
  get(address: string): Promise<AuthChallengeRecord | null>;
  consume(address: string, expectedMessage: string): Promise<boolean>;
  close?(): Promise<void>;
}

function challengeKey(address: string) {
  return `pactagent:auth-challenge:${createHash('sha256').update(address).digest('hex')}`;
}

export class MemoryAuthChallengeStore implements AuthChallengeStore {
  private readonly records = new Map<string, AuthChallengeRecord>();

  async put(record: AuthChallengeRecord, _ttlMs: number) {
    this.records.set(record.address, record);
  }

  async get(address: string) {
    const record = this.records.get(address) ?? null;
    if (record && record.expiresAt <= Date.now()) {
      this.records.delete(address);
      return null;
    }
    return record;
  }

  async consume(address: string, expectedMessage: string) {
    const record = await this.get(address);
    if (!record || record.message !== expectedMessage) return false;
    this.records.delete(address);
    return true;
  }
}

export class RedisAuthChallengeStore implements AuthChallengeStore {
  private readonly client;
  private connection: Promise<void> | null = null;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (error) => log('error', 'auth_challenge.redis.error', { error }));
  }

  private async connect() {
    if (this.client.isReady) return;
    this.connection ??= this.client.connect().then(() => undefined).finally(() => {
      this.connection = null;
    });
    await this.connection;
  }

  async put(record: AuthChallengeRecord, ttlMs: number) {
    await this.connect();
    await this.client.set(challengeKey(record.address), JSON.stringify(record), { PX: ttlMs });
  }

  async get(address: string) {
    await this.connect();
    const raw = await this.client.get(challengeKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthChallengeRecord;
    if (parsed.address !== address || typeof parsed.message !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return parsed;
  }

  async consume(address: string, expectedMessage: string) {
    await this.connect();
    const result = await this.client.eval(
      "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local value=cjson.decode(raw); if value.address~=ARGV[1] or value.message~=ARGV[2] then return 0 end; redis.call('DEL',KEYS[1]); return 1",
      { keys: [challengeKey(address)], arguments: [address, expectedMessage] },
    );
    return Number(result) === 1;
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}

let challengeStore: AuthChallengeStore = config.redisUrl
  ? new RedisAuthChallengeStore(config.redisUrl)
  : new MemoryAuthChallengeStore();

export function getAuthChallengeStore() {
  return challengeStore;
}

export function setAuthChallengeStoreForTests(store: AuthChallengeStore | null) {
  challengeStore = store ?? (config.redisUrl
    ? new RedisAuthChallengeStore(config.redisUrl)
    : new MemoryAuthChallengeStore());
}

export async function closeAuthChallengeStore() {
  await challengeStore.close?.();
}
