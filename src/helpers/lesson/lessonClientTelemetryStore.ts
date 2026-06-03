/**
 * Persisted lesson client telemetry (Redis when enabled, in-memory fallback).
 */
import { REDIS_KEYS, REDIS_TTL } from "../../config/redis";
import {
  isRedisEnabled,
  redisDel,
  redisGetJson,
  redisSetJson,
} from "../../services/redisClient";
import type { LessonClientKind } from "./lessonClientTelemetry";

export type LessonParticipantClientRow = {
  userId: string;
  role: "trainer" | "trainee";
  client: LessonClientKind;
  updatedAt: number;
};

type SessionTelemetryBlob = {
  participants: Record<string, LessonParticipantClientRow>;
};

const memoryBySession = new Map<string, SessionTelemetryBlob>();

function redisKey(sessionId: string): string {
  return REDIS_KEYS.lessonClientTelemetry(sessionId);
}

async function loadBlob(sessionId: string): Promise<SessionTelemetryBlob> {
  const sid = String(sessionId);
  if (isRedisEnabled()) {
    const remote = await redisGetJson<SessionTelemetryBlob>(redisKey(sid));
    if (remote?.participants && typeof remote.participants === "object") {
      return remote;
    }
    return { participants: {} };
  }
  return memoryBySession.get(sid) ?? { participants: {} };
}

async function saveBlob(sessionId: string, blob: SessionTelemetryBlob): Promise<void> {
  const sid = String(sessionId);
  if (isRedisEnabled()) {
    await redisSetJson(
      redisKey(sid),
      blob,
      REDIS_TTL.LESSON_CLIENT_TELEMETRY_SEC
    );
    return;
  }
  memoryBySession.set(sid, blob);
}

export async function recordLessonParticipantClient(params: {
  sessionId: string;
  userId: string;
  accountType: string;
  clientKind: LessonClientKind;
}): Promise<void> {
  const sid = String(params.sessionId);
  const uid = String(params.userId);
  const role = params.accountType === "Trainer" ? "trainer" : "trainee";
  const blob = await loadBlob(sid);
  blob.participants[uid] = {
    userId: uid,
    role,
    client: params.clientKind,
    updatedAt: Date.now(),
  };
  await saveBlob(sid, blob);
}

export async function getLessonParticipantClients(
  sessionId: string
): Promise<LessonParticipantClientRow[]> {
  const blob = await loadBlob(String(sessionId));
  return Object.values(blob.participants);
}

export async function clearLessonClientTelemetry(sessionId: string): Promise<void> {
  const sid = String(sessionId);
  memoryBySession.delete(sid);
  if (isRedisEnabled()) {
    await redisDel(redisKey(sid));
  }
}

export async function getPeerLessonClientKind(params: {
  sessionId: string;
  viewerUserId: string;
  isTrainer: boolean;
}): Promise<LessonClientKind | null> {
  const rows = await getLessonParticipantClients(params.sessionId);
  const peerRole = params.isTrainer ? "trainee" : "trainer";
  const peer = rows.find(
    (r) => r.role === peerRole && r.userId !== String(params.viewerUserId)
  );
  return peer?.client ?? null;
}

/** Test-only: reset in-memory map. */
export function _clearLessonClientTelemetryMemoryForTests(): void {
  memoryBySession.clear();
}
