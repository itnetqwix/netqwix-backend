import { REDIS_KEYS, REDIS_PREFIX, REDIS_TTL } from "../../config/redis";
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import {
  getRedis,
  isRedisEnabled,
  redisDel,
  redisDelByPattern,
  redisGetJson,
  redisSetJson,
} from "../../services/redisClient";

type PendingChatMedia = {
  userId: string;
  s3Key: string;
  createdAt: number;
};

const memoryPending = new Map<string, PendingChatMedia>();

function pendingKey(s3Key: string): string {
  return REDIS_KEYS.chatMediaPending(s3Key);
}

/** Track presigned uploads until send, abort, or cron sweep. */
export async function registerPendingChatMedia(
  userId: string,
  s3Key: string
): Promise<void> {
  const row: PendingChatMedia = {
    userId: String(userId),
    s3Key: String(s3Key),
    createdAt: Date.now(),
  };
  if (isRedisEnabled()) {
    await redisSetJson(
      pendingKey(s3Key),
      row,
      REDIS_TTL.CHAT_MEDIA_PENDING_SEC
    );
  } else {
    memoryPending.set(s3Key, row);
  }
}

export async function clearPendingChatMedia(s3Key: string): Promise<void> {
  if (!s3Key) return;
  if (isRedisEnabled()) {
    await redisDel(pendingKey(s3Key));
  } else {
    memoryPending.delete(s3Key);
  }
}

export function chatMediaKeyFromUrl(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl || typeof mediaUrl !== "string") return null;
  const idx = mediaUrl.indexOf("chat-media/");
  if (idx < 0) return null;
  const rest = mediaUrl.slice(idx).split("?")[0];
  return rest || null;
}

/**
 * Delete S3 objects that were presigned but never linked to a chat message.
 * Runs on a schedule; safe because keys are user-scoped and TTL-bounded in Redis.
 */
export async function sweepOrphanChatMediaObjects(maxAgeMs = 2 * 60 * 60 * 1000): Promise<{
  scanned: number;
  deleted: number;
  errors: number;
}> {
  let scanned = 0;
  let deleted = 0;
  let errors = 0;
  const now = Date.now();

  const processRow = async (row: PendingChatMedia) => {
    if (now - row.createdAt < maxAgeMs) return;
    scanned += 1;
    try {
      await s3.deleteObject({ Bucket: S3_BUCKET, Key: row.s3Key }).promise();
      await clearPendingChatMedia(row.s3Key);
      deleted += 1;
    } catch (err) {
      errors += 1;
      console.warn("[chatMediaSweep] delete failed", row.s3Key, err);
    }
  };

  if (isRedisEnabled()) {
    const pattern = `${REDIS_PREFIX}:chat-media-pending:*`;
    const redis = getRedis();
    if (redis) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 50);
        cursor = next;
        for (const key of keys) {
          const row = await redisGetJson<PendingChatMedia>(key);
          if (row) await processRow(row);
        }
      } while (cursor !== "0");
    }
  } else {
    for (const row of memoryPending.values()) {
      await processRow(row);
    }
  }

  if (scanned > 0) {
    console.log(
      `[chatMediaSweep] scanned=${scanned} deleted=${deleted} errors=${errors}`
    );
  }
  return { scanned, deleted, errors };
}

export async function clearAllPendingChatMediaForDev(): Promise<void> {
  if (isRedisEnabled()) {
    await redisDelByPattern(`${REDIS_PREFIX}:chat-media-pending:*`);
  } else {
    memoryPending.clear();
  }
}
