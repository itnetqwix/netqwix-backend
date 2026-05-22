import { REDIS_KEYS, REDIS_TTL } from "../../config/redis";
import {
  isRedisEnabled,
  redisDel,
  redisGetJson,
  redisSetJson,
} from "../../services/redisClient";

/** Serializable snapshot of in-room lesson timer (timeouts are process-local only). */
export type LessonTimerSnapshot = {
  sessionId: string;
  coachJoined: boolean;
  userJoined: boolean;
  startedAt: number | null;
  duration: number;
  remainingSeconds: number;
  status: "waiting" | "running" | "paused" | "ended";
  trainerLeftPaused?: boolean;
  isInstant?: boolean;
  coachFirstJoinedAt?: number | null;
  userFirstJoinedAt?: number | null;
  pauseReason?: string | null;
  preExtensionPauseStatus?: "running" | "paused" | "ended" | null;
  pendingExtensionRequest?: Record<string, unknown> | null;
};

type StoredSession = LessonTimerSnapshot & {
  warningTimeoutId?: NodeJS.Timeout | null;
  endTimeoutId?: NodeJS.Timeout | null;
};

const localSessions = new Map<string, StoredSession>();

function persist(sessionId: string, snap: LessonTimerSnapshot): void {
  if (!isRedisEnabled()) return;
  void redisSetJson(
    REDIS_KEYS.lessonTimer(sessionId),
    snap,
    REDIS_TTL.LESSON_TIMER_SEC
  ).catch((err) => console.warn("[lessonTimerStore] persist failed", err));
}

export function getLessonSession(sessionId: string): StoredSession | undefined {
  return localSessions.get(String(sessionId));
}

export function setLessonSession(sessionId: string, session: StoredSession): void {
  const sid = String(sessionId);
  localSessions.set(sid, session);
  const { warningTimeoutId, endTimeoutId, ...snap } = session;
  persist(sid, snap);
}

export function deleteLessonSession(sessionId: string): void {
  const sid = String(sessionId);
  localSessions.delete(sid);
  if (isRedisEnabled()) {
    void redisDel(REDIS_KEYS.lessonTimer(sid));
  }
}

/** Hydrate local map from Redis after reconnect or cold start on this pod. */
export async function hydrateLessonSessionFromRedis(
  sessionId: string
): Promise<StoredSession | undefined> {
  const sid = String(sessionId);
  if (localSessions.has(sid)) return localSessions.get(sid);
  if (!isRedisEnabled()) return undefined;
  const snap = await redisGetJson<LessonTimerSnapshot>(REDIS_KEYS.lessonTimer(sid));
  if (!snap) return undefined;
  const hydrated: StoredSession = {
    ...snap,
    warningTimeoutId: null,
    endTimeoutId: null,
  };
  localSessions.set(sid, hydrated);
  return hydrated;
}

export function hasLessonSession(sessionId: string): boolean {
  return localSessions.has(String(sessionId));
}
