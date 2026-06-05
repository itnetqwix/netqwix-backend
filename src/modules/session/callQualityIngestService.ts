/**
 * Call quality stats ingest — sampling policy and persistence.
 */

import CallDiagnostics from "../../model/call_diagnostics.schema";
import { normalizeCallQualityStatsPayload } from "../../helpers/robustness/callQualityPayload";
import { logCallQualityOps } from "../ops/opsCallLogger";
import { updateQualitySnapshot } from "./lessonLiveStateStore";

export const CALL_QUALITY_DB_SAMPLE_RATE = 0.2;

export type CallQualityIngestInput = {
  payload: unknown;
  userId?: string;
  accountType?: string;
  role?: string;
  emitToRoom: (event: string, data: unknown) => void;
};

export async function ingestCallQualityStats(input: CallQualityIngestInput): Promise<void> {
  const normalized = normalizeCallQualityStatsPayload(input.payload);
  const { role, stats } = (input.payload as Record<string, unknown>) || {};
  const sessionId = String(
    (input.payload as { sessionId?: string })?.sessionId ?? normalized?.sessionId ?? ""
  ).trim();
  if (!sessionId || !stats?.quality) return;

  if (input.userId && Math.random() < CALL_QUALITY_DB_SAMPLE_RATE) {
    try {
      await CallDiagnostics.create({
        sessionId,
        userId: input.userId,
        accountType: input.accountType,
        role,
        eventType: "CALL_QUALITY_STATS",
        qualityStats: stats,
      });
    } catch (dbErr) {
      console.error("[CallQuality] Failed to save to DB:", dbErr);
    }
  }

  if (input.userId) {
    logCallQualityOps({
      sessionId: String(sessionId),
      userId: String(input.userId),
      stats,
      role,
    });

    const qualityRole =
      role === "trainer" || input.accountType === "Trainer" ? "trainer" : "trainee";
    const snap = updateQualitySnapshot(String(sessionId), qualityRole, {
      overallScore: (stats as any)?.quality?.overallScore,
      rtt: (stats as any)?.quality?.rtt,
    });
    input.emitToRoom("LESSON_QUALITY_UPDATE", {
      sessionId: String(sessionId),
      role: qualityRole,
      quality: snap,
    });
  }
}
