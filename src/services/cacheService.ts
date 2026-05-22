import { createHash } from "crypto";
import {
  getRedis,
  isRedisEnabled,
  redisDelByPattern,
  redisGetJson,
  redisSetJson,
} from "./redisClient";
import { REDIS_KEYS } from "../config/redis";

export function stableHash(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Read-through cache. When Redis is disabled, always calls `loader` directly.
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  if (isRedisEnabled()) {
    const cached = await redisGetJson<T>(key);
    if (cached != null) return cached;
  }
  const fresh = await loader();
  if (isRedisEnabled() && fresh != null) {
    await redisSetJson(key, fresh, ttlSeconds);
  }
  return fresh;
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  if (!isRedisEnabled()) return;
  await redisDelByPattern(pattern);
}

export function sessionsListCacheKey(
  userId: string,
  status: string,
  page: number,
  limit: number
): string {
  return REDIS_KEYS.cache(
    `sessions:${userId}:${status || "all"}:p${page}:l${limit}`
  );
}

export function sessionsListInvalidatePattern(userId: string): string {
  return `${REDIS_KEYS.cache(`sessions:${userId}:*`).replace(/:\*$/, "")}*`;
}

export function trainerSlotsCacheKey(query: Record<string, unknown>): string {
  return REDIS_KEYS.cache(`trainers-slots:${stableHash(query)}`);
}

export async function invalidateUserSessionsCache(userId: string): Promise<void> {
  await cacheInvalidate(sessionsListInvalidatePattern(userId));
}
