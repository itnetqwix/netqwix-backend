import { REDIS_KEYS, REDIS_TTL } from "../../config/redis";
import { REDIS_PREFIX } from "../../config/redis";
import {
  isRedisEnabled,
  redisDel,
  redisDelByPattern,
  redisGetJson,
  redisSetJson,
} from "../../services/redisClient";
import { isLessonCallSocketLive } from "./lessonCallSlotIo";

export type LessonCallSlotHolder = {
  socketId: string;
  authSessionId?: string;
  deviceId?: string;
  claimedAt: number;
};

const memorySlots = new Map<string, LessonCallSlotHolder>();

function slotKey(sessionId: string, userId: string): string {
  return `${String(sessionId)}:${String(userId)}`;
}

function redisKey(sessionId: string, userId: string): string {
  return REDIS_KEYS.lessonCallSlot(sessionId, userId);
}

async function getHolder(
  sessionId: string,
  userId: string
): Promise<LessonCallSlotHolder | null> {
  const key = slotKey(sessionId, userId);
  if (isRedisEnabled()) {
    return redisGetJson<LessonCallSlotHolder>(redisKey(sessionId, userId));
  }
  return memorySlots.get(key) ?? null;
}

async function setHolder(
  sessionId: string,
  userId: string,
  holder: LessonCallSlotHolder,
  ttlSec = REDIS_TTL.LESSON_CALL_SLOT_SEC
): Promise<void> {
  const key = slotKey(sessionId, userId);
  if (isRedisEnabled()) {
    await redisSetJson(redisKey(sessionId, userId), holder, ttlSec);
  } else {
    memorySlots.set(key, holder);
  }
}

function holderIsStale(holder: LessonCallSlotHolder): boolean {
  return !isLessonCallSocketLive(holder.socketId);
}

/**
 * One active call slot per (session, user). Blocks a second device; allows
 * reconnect from the same auth session or device id.
 */
export async function claimLessonCallSlot(params: {
  sessionId: string;
  userId: string;
  socketId: string;
  authSessionId?: string;
  deviceId?: string;
  /** Use shorter TTL for instant lessons. */
  isInstant?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { sessionId, userId, socketId } = params;
  const authSessionId = params.authSessionId
    ? String(params.authSessionId)
    : undefined;
  const deviceId = params.deviceId ? String(params.deviceId) : undefined;
  const ttlSec = params.isInstant
    ? REDIS_TTL.LESSON_CALL_SLOT_INSTANT_SEC
    : REDIS_TTL.LESSON_CALL_SLOT_SEC;

  const writeHolder = async (holder: LessonCallSlotHolder) => {
    await setHolder(sessionId, userId, holder, ttlSec);
  };

  const existing = await getHolder(sessionId, userId);
  if (!existing) {
    await writeHolder({
      socketId,
      authSessionId,
      deviceId,
      claimedAt: Date.now(),
    });
    return { ok: true };
  }

  if (existing.socketId === socketId) {
    await writeHolder({
      ...existing,
      socketId,
      authSessionId: authSessionId ?? existing.authSessionId,
      deviceId: deviceId ?? existing.deviceId,
      claimedAt: Date.now(),
    });
    return { ok: true };
  }

  if (holderIsStale(existing)) {
    await writeHolder({
      socketId,
      authSessionId,
      deviceId,
      claimedAt: Date.now(),
    });
    return { ok: true };
  }

  const sameSession =
    authSessionId &&
    existing.authSessionId &&
    authSessionId === existing.authSessionId;
  const sameDevice =
    deviceId && existing.deviceId && deviceId === existing.deviceId;

  if (sameSession || sameDevice) {
    await writeHolder({
      socketId,
      authSessionId: authSessionId ?? existing.authSessionId,
      deviceId: deviceId ?? existing.deviceId,
      claimedAt: Date.now(),
    });
    return { ok: true };
  }

  return { ok: false, reason: "already_active_elsewhere" };
}

export type LessonCallSlotStatus = {
  canJoin: boolean;
  reason?: string;
  /** Holder exists but socket is gone — next join will reclaim. */
  stale?: boolean;
  /** Another live device holds the slot. */
  activeElsewhere?: boolean;
  /** User may call takeover to displace the other device. */
  canTakeOver?: boolean;
};

/** Pre-join HTTP check (mobile lobby / web preflight). */
export async function getLessonCallSlotStatus(params: {
  sessionId: string;
  userId: string;
  authSessionId?: string;
  deviceId?: string;
}): Promise<LessonCallSlotStatus> {
  const existing = await getHolder(params.sessionId, params.userId);
  if (!existing) {
    return { canJoin: true };
  }
  if (holderIsStale(existing)) {
    return { canJoin: true, stale: true };
  }

  const authSessionId = params.authSessionId
    ? String(params.authSessionId)
    : undefined;
  const deviceId = params.deviceId ? String(params.deviceId) : undefined;
  const sameSession =
    authSessionId &&
    existing.authSessionId &&
    authSessionId === existing.authSessionId;
  const sameDevice =
    deviceId && existing.deviceId && deviceId === existing.deviceId;

  if (sameSession || sameDevice) {
    return { canJoin: true };
  }

  return {
    canJoin: false,
    reason: "already_active_elsewhere",
    activeElsewhere: true,
    canTakeOver: true,
  };
}

async function forceReleaseHolder(
  sessionId: string,
  userId: string
): Promise<LessonCallSlotHolder | null> {
  const existing = await getHolder(sessionId, userId);
  const key = slotKey(sessionId, userId);
  if (isRedisEnabled()) {
    await redisDel(redisKey(sessionId, userId));
  } else {
    memorySlots.delete(key);
  }
  return existing;
}

/**
 * HTTP pre-join: clear the slot so the next ON_CALL_JOIN succeeds. Notifies the
 * previous live socket via the caller (commonService / socket handler).
 */
export async function takeoverLessonCallSlotHttp(params: {
  sessionId: string;
  userId: string;
}): Promise<{ ok: true; previousSocketId?: string } | { ok: false; reason: string }> {
  const existing = await getHolder(params.sessionId, params.userId);
  if (!existing || holderIsStale(existing)) {
    await forceReleaseHolder(params.sessionId, params.userId);
    return { ok: true, previousSocketId: existing?.socketId };
  }
  const previousSocketId = existing.socketId;
  await forceReleaseHolder(params.sessionId, params.userId);
  return { ok: true, previousSocketId };
}

/**
 * In-call takeover: assign this socket as the active holder and return the
 * displaced socket id for CALL_SLOT_TAKEN_OVER.
 */
export async function takeoverLessonCallSlot(params: {
  sessionId: string;
  userId: string;
  socketId: string;
  authSessionId?: string;
  deviceId?: string;
  isInstant?: boolean;
}): Promise<
  { ok: true; previousSocketId?: string } | { ok: false; reason: string }
> {
  const ttlSec = params.isInstant
    ? REDIS_TTL.LESSON_CALL_SLOT_INSTANT_SEC
    : REDIS_TTL.LESSON_CALL_SLOT_SEC;
  const existing = await getHolder(params.sessionId, params.userId);
  const previousSocketId =
    existing &&
    existing.socketId !== params.socketId &&
    !holderIsStale(existing)
      ? existing.socketId
      : undefined;

  await setHolder(
    params.sessionId,
    params.userId,
    {
      socketId: params.socketId,
      authSessionId: params.authSessionId,
      deviceId: params.deviceId,
      claimedAt: Date.now(),
    },
    ttlSec
  );
  return { ok: true, previousSocketId };
}

export async function releaseLessonCallSlot(params: {
  sessionId: string;
  userId: string;
  socketId: string;
}): Promise<void> {
  const existing = await getHolder(params.sessionId, params.userId);
  if (!existing || existing.socketId !== params.socketId) return;

  const key = slotKey(params.sessionId, params.userId);
  if (isRedisEnabled()) {
    await redisDel(redisKey(params.sessionId, params.userId));
  } else {
    memorySlots.delete(key);
  }
}

/** Clear all call slots when a lesson ends (both parties may rejoin a future session). */
export async function releaseAllLessonCallSlotsForSession(
  sessionId: string
): Promise<void> {
  const sid = String(sessionId);
  for (const key of [...memorySlots.keys()]) {
    if (key.startsWith(`${sid}:`)) {
      memorySlots.delete(key);
    }
  }
  if (isRedisEnabled()) {
    await redisDelByPattern(`${REDIS_PREFIX}:callslot:${sid}:*`);
  }
}
