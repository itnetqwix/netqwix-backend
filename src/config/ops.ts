/** Operations log categories and allowed client event types. */
export const OPS_CATEGORIES = [
  "instant_lesson",
  "call",
  "connection",
  "wallet",
  "payment",
  "support",
  "system",
  "admin",
] as const;

export type OpsCategory = (typeof OPS_CATEGORIES)[number];

export const OPS_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type OpsSeverity = (typeof OPS_SEVERITIES)[number];

export const OPS_RESOLUTION_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "wont_fix",
] as const;

/** Client-reportable event types (allowlist). */
export const CLIENT_ALLOWED_EVENT_TYPES = new Set([
  "CLIENT_CALL_ERROR",
  "CLIENT_PRECALL_FAILED",
  "CLIENT_LESSON_TIMER_ERROR",
  "CLIENT_WEBVIEW_ERROR",
  "INSTANT_LESSON_BOOKING_FAILED",
  "CONNECTION_TIMEOUT",
  "SOCKET_RECONNECT_FAILED",
]);
