import { recordOpsEvent } from "./opsEventService";

export function logPrecallCheckOps(payload: {
  sessionId: string;
  userId: string;
  passed?: boolean;
  reason?: string;
  role?: string;
  accountType?: string;
}) {
  if (payload.passed !== false) return;
  recordOpsEvent({
    category: "connection",
    severity: "error",
    event_type: "CLIENT_PRECALL_FAILED",
    user_id: payload.userId,
    session_id: payload.sessionId,
    title: "Pre-call check failed",
    summary: payload.reason,
    payload,
    source: "client",
    idempotency_key: `precall:${payload.sessionId}:${payload.userId}:${payload.reason || "fail"}`,
  });
}

export function logCallQualityOps(payload: {
  sessionId: string;
  userId: string;
  stats?: { quality?: { overallScore?: number } };
  role?: string;
}) {
  const score = payload.stats?.quality?.overallScore;
  if (score == null || score >= 40) return;
  recordOpsEvent({
    category: "call",
    severity: score < 25 ? "error" : "warning",
    event_type: "CALL_QUALITY_LOW",
    user_id: payload.userId,
    session_id: payload.sessionId,
    title: "Low call quality",
    summary: `Overall score: ${score}`,
    payload,
    source: "client",
    idempotency_key: `quality:${payload.sessionId}:${payload.userId}:${Math.floor(Date.now() / 60000)}`,
  });
}
