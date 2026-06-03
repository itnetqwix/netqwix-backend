/**
 * In-call client telemetry for join-readiness (P10 / mixed native + web).
 * Storage: Redis when REDIS_ENABLED=true, else in-process Map (single instance).
 */

export type LessonClientKind = "native_app" | "web" | "unknown";

export {
  clearLessonClientTelemetry,
  getLessonParticipantClients,
  getPeerLessonClientKind,
  recordLessonParticipantClient,
} from "./lessonClientTelemetryStore";

export function parseLessonClientKindFromHeaders(
  headers: Record<string, unknown> | null | undefined
): LessonClientKind {
  const raw = String(headers?.["x-nq-client"] ?? headers?.["X-NQ-Client"] ?? "")
    .trim()
    .toLowerCase();
  if (raw === "mobile") return "native_app";
  if (raw === "web" || raw === "desktop") return "web";
  return "unknown";
}

/** Human-readable warning for precall / join-readiness (matrix P10). */
export function computeMixedClientWarning(params: {
  viewerClient: LessonClientKind;
  peerClient: LessonClientKind | null;
  peerRole: "trainer" | "trainee";
}): string | null {
  const peerLabel = params.peerRole === "trainer" ? "coach" : "trainee";
  if (params.viewerClient === "web") {
    return "Live lessons work best in the NetQwix mobile app. Some features may be limited in the browser.";
  }
  if (params.peerClient === "web") {
    return `Your ${peerLabel} is on the web app. Screenshots, drawing sync, and video quality may be limited until they use the mobile app.`;
  }
  return null;
}
