import { REDIS_KEYS, REDIS_TTL } from "../config/redis";
import {
  isRedisEnabled,
  redisAcquireLock,
  redisReleaseLock,
} from "./redisClient";

const localLocks = new Set<string>();

/**
 * Run `fn` while holding a short-lived lock. Without Redis, uses an in-process
 * Set (single-instance only).
 */
export async function withDistributedLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttlSeconds = REDIS_TTL.LOCK_SEC
): Promise<T> {
  const key = REDIS_KEYS.lock(resource);
  if (!isRedisEnabled()) {
    if (localLocks.has(resource)) {
      throw new Error("RESOURCE_LOCKED");
    }
    localLocks.add(resource);
    try {
      return await fn();
    } finally {
      localLocks.delete(resource);
    }
  }
  const acquired = await redisAcquireLock(key, ttlSeconds);
  if (!acquired) {
    throw new Error("RESOURCE_LOCKED");
  }
  try {
    return await fn();
  } finally {
    await redisReleaseLock(key);
  }
}
