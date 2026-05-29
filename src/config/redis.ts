/** Redis configuration — key prefixes and TTLs (seconds). */

export const REDIS_ENABLED =
  String(process.env.REDIS_ENABLED ?? "false").toLowerCase() === "true";

export const REDIS_URL =
  process.env.REDIS_URL ||
  (process.env.REDIS_HOST
    ? `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ""}${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}/${process.env.REDIS_DB || 0}`
    : "redis://127.0.0.1:6379/0");

/** Namespace prefix — bump version when payload shape changes. */
export const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || "nq";

export const REDIS_KEYS = {
  socketRegistry: (userId: string) => `${REDIS_PREFIX}:socket:${userId}`,
  lessonTimer: (sessionId: string) => `${REDIS_PREFIX}:lesson:${sessionId}`,
  lessonCallSlot: (sessionId: string, userId: string) =>
    `${REDIS_PREFIX}:callslot:${sessionId}:${userId}`,
  cache: (segment: string) => `${REDIS_PREFIX}:cache:${segment}`,
  idempotency: (key: string) => `${REDIS_PREFIX}:idempotency:${key}`,
  lock: (resource: string) => `${REDIS_PREFIX}:lock:${resource}`,
  rateLimit: (name: string, id: string) => `${REDIS_PREFIX}:rl:${name}:${id}`,
  chatMediaPending: (s3Key: string) =>
    `${REDIS_PREFIX}:chat-media-pending:${s3Key}`,
} as const;

export const REDIS_TTL = {
  /** Socket mapping — refreshed on connect; safety cap 24h. */
  SOCKET_REGISTRY_SEC: 86400,
  /** Lesson timer snapshot — max session length + buffer. */
  LESSON_TIMER_SEC: 6 * 60 * 60,
  /** Active call lease per user per session (scheduled lessons). */
  LESSON_CALL_SLOT_SEC: 4 * 60 * 60,
  /** Shorter lease for instant lessons — faster recovery if disconnect is missed. */
  LESSON_CALL_SLOT_INSTANT_SEC: 90 * 60,
  /** Scheduled meetings list per user/tab. */
  SESSIONS_LIST_SEC: 60,
  /** Trainer discovery / slots. */
  TRAINER_SLOTS_SEC: 300,
  /** User profile snippet. */
  USER_PROFILE_SEC: 120,
  /** Wallet balance (short — money must be fresh). */
  WALLET_BALANCE_SEC: 30,
  /** Idempotency keys for payments. */
  IDEMPOTENCY_SEC: 86400,
  /** Distributed lock hold time. */
  LOCK_SEC: 15,
  /** Presigned chat media not yet committed via /chat-send. */
  CHAT_MEDIA_PENDING_SEC: 48 * 60 * 60,
} as const;
