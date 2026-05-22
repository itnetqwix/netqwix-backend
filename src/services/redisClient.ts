import Redis from "ioredis";
import { log } from "../../logger";
import { REDIS_ENABLED, REDIS_URL, REDIS_KEYS } from "../config/redis";

const logger = log.getLogger();

let client: Redis | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

export function isRedisEnabled(): boolean {
  return REDIS_ENABLED;
}

export function getRedis(): Redis | null {
  if (!REDIS_ENABLED) return null;
  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    client.on("error", (err) => {
      logger.error(`[Redis] ${err?.message || err}`);
    });
  }
  return client;
}

/** Dedicated pub/sub clients for Socket.IO adapter (must not share one connection). */
export async function getRedisPubSub(): Promise<{
  pub: Redis;
  sub: Redis;
} | null> {
  if (!REDIS_ENABLED) return null;
  if (!pubClient) {
    pubClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    subClient = pubClient.duplicate();
    const connects: Promise<void>[] = [];
    if (pubClient.status === "wait") connects.push(pubClient.connect());
    if (subClient.status === "wait") connects.push(subClient.connect());
    if (connects.length) await Promise.all(connects);
  }
  return { pub: pubClient!, sub: subClient! };
}

export async function connectRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.ping();
    logger.info("[Redis] Connected");
    return true;
  } catch (err: any) {
    logger.error(`[Redis] Connect failed: ${err?.message || err}`);
    return false;
  }
}

export async function redisHealthCheck(): Promise<{
  enabled: boolean;
  ok: boolean;
  latencyMs?: number;
}> {
  if (!REDIS_ENABLED) {
    return { enabled: false, ok: true };
  }
  const redis = getRedis();
  if (!redis) return { enabled: true, ok: false };
  const start = Date.now();
  try {
    await redis.ping();
    return { enabled: true, ok: true, latencyMs: Date.now() - start };
  } catch {
    return { enabled: true, ok: false };
  }
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const payload = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, payload, "EX", ttlSeconds);
  } else {
    await redis.set(key, payload);
  }
}

export async function redisDel(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(key);
}

export async function redisDelByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = next;
    if (keys.length) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== "0");
  return deleted;
}

/** SET key value NX EX — returns true if lock acquired. */
export async function redisAcquireLock(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function redisReleaseLock(key: string): Promise<void> {
  await redisDel(key);
}

/** Sliding-window rate limit (INCR + PEXPIRE). Returns allowed when Redis is off. */
export async function redisRateLimitCheck(
  name: string,
  identifier: string,
  windowMs: number,
  max: number
): Promise<{ allowed: boolean; count: number }> {
  const redis = getRedis();
  if (!redis) return { allowed: true, count: 0 };
  const key = REDIS_KEYS.rateLimit(name, identifier);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, windowMs);
  }
  return { allowed: count <= max, count };
}
