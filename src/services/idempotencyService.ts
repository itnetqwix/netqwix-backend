import { REDIS_KEYS, REDIS_TTL } from "../config/redis";
import {
  isRedisEnabled,
  redisGetJson,
  redisSetJson,
} from "./redisClient";

export type IdempotencyRecord = {
  status: "processing" | "completed";
  result?: unknown;
  createdAt: number;
};

/**
 * Ensures a mutating operation runs at most once per idempotency key.
 * When Redis is off, always runs `fn` (legacy behavior).
 */
export type IdempotencyResult<T> = {
  value: T;
  replayed: boolean;
};

export async function runIdempotency<T>(
  key: string,
  fn: () => Promise<T>
): Promise<IdempotencyResult<T>> {
  if (!isRedisEnabled()) {
    const value = await fn();
    return { value, replayed: false };
  }
  const redisKey = REDIS_KEYS.idempotency(key);
  const existing = await redisGetJson<IdempotencyRecord>(redisKey);
  if (existing?.status === "completed" && existing.result !== undefined) {
    return { value: existing.result as T, replayed: true };
  }
  if (existing?.status === "processing") {
    throw new Error("IDEMPOTENCY_IN_PROGRESS");
  }
  await redisSetJson(
    redisKey,
    { status: "processing", createdAt: Date.now() } satisfies IdempotencyRecord,
    REDIS_TTL.IDEMPOTENCY_SEC
  );
  try {
    const result = await fn();
    await redisSetJson(
      redisKey,
      {
        status: "completed",
        result,
        createdAt: Date.now(),
      } satisfies IdempotencyRecord,
      REDIS_TTL.IDEMPOTENCY_SEC
    );
    return { value: result, replayed: false };
  } catch (err) {
    const { redisDel } = await import("./redisClient");
    await redisDel(redisKey);
    throw err;
  }
}

export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const { value } = await runIdempotency(key, fn);
  return value;
}
