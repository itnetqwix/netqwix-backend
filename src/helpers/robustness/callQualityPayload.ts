/**
 * Normalize client CALL_QUALITY_STATS socket payloads before persistence.
 * Matrix: P8 (QA_10_PILLAR_MATRIX).
 */

export type NormalizedCallQualityStats = {
  sessionId: string;
  packetLossPercent: number | null;
  roundTripTimeMs: number | null;
  jitterMs: number | null;
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCallQualityStatsPayload(
  raw: unknown
): NormalizedCallQualityStats | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionId = String(o.sessionId ?? o.session_id ?? "").trim();
  if (!sessionId) return null;
  const packetLossPercent = toNum(o.packetLossPercent ?? o.packet_loss);
  const roundTripTimeMs = toNum(o.roundTripTimeMs ?? o.rtt ?? o.round_trip_ms);
  const jitterMs = toNum(o.jitterMs ?? o.jitter);
  if (
    packetLossPercent == null &&
    roundTripTimeMs == null &&
    jitterMs == null
  ) {
    return null;
  }
  return { sessionId, packetLossPercent, roundTripTimeMs, jitterMs };
}
