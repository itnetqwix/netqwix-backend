import { recordOpsEvent, type SuggestedAction } from "./opsEventService";

const instantActions = (sessionId: string): SuggestedAction[] => [
  { action: "open_booking", label: "Open booking", href: `/apps/booking?sessionId=${sessionId}` },
  { action: "refund", label: "Process refund", href: `/apps/booking?sessionId=${sessionId}&refund=1` },
  { action: "call_diagnostics", label: "Call diagnostics", href: `/apps/call-diagnostics?sessionId=${sessionId}` },
];

export function logInstantLessonOps(
  eventType: string,
  opts: {
    lessonId: string;
    coachId?: string;
    traineeId?: string;
    severity?: string;
    title: string;
    summary?: string;
    payload?: Record<string, unknown>;
  }
) {
  const severity =
    opts.severity ||
    (eventType.includes("EXPIRE") || eventType.includes("DECLINE") || eventType.includes("CANCEL")
      ? "warning"
      : "info");

  recordOpsEvent({
    category: "instant_lesson",
    severity,
    event_type: eventType,
    user_id: opts.traineeId,
    related_user_id: opts.coachId,
    session_id: opts.lessonId,
    title: opts.title,
    summary: opts.summary,
    payload: opts.payload,
    source: "server",
    idempotency_key: `instant:${eventType}:${opts.lessonId}:${Date.now()}`,
    suggested_actions: instantActions(opts.lessonId),
  });
}
