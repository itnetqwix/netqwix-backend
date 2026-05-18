/** Instant-lesson timing rules (accept window + post-accept join window + post-session buffer). */
export const INSTANT_ACCEPT_WINDOW_MS = 2 * 60 * 1000;
export const INSTANT_JOIN_AFTER_ACCEPT_MS = 2 * 60 * 1000;
export const INSTANT_BUFFER_AFTER_SESSION_MS = 15 * 60 * 1000;
export const INSTANT_REFUND_SLA_MS = 24 * 60 * 60 * 1000;

export const INSTANT_ALLOWED_DURATIONS = [15, 30] as const;
export type InstantAllowedDuration = (typeof INSTANT_ALLOWED_DURATIONS)[number];

export const INSTANT_PHASE = {
  PENDING_ACCEPT: "pending_accept",
  PENDING_JOIN: "pending_join",
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type InstantPhase = (typeof INSTANT_PHASE)[keyof typeof INSTANT_PHASE];

export const INSTANT_REFUND_REASON = {
  ACCEPT_EXPIRED: "accept_expired",
  DECLINED: "declined",
  JOIN_EXPIRED: "join_expired",
  NO_SHOW: "no_show",
  TRAINER_CANCELLED: "trainer_cancelled",
  TRAINEE_CANCELLED: "trainee_cancelled",
} as const;

/** Total reservation window from request time (accept + join + lesson + buffer). */
export function computeInstantReservationWindowMs(durationMinutes: number): number {
  const lessonMs = durationMinutes * 60 * 1000;
  return (
    INSTANT_ACCEPT_WINDOW_MS +
    INSTANT_JOIN_AFTER_ACCEPT_MS +
    lessonMs +
    INSTANT_BUFFER_AFTER_SESSION_MS
  );
}

export function isInstantAllowedDuration(minutes: number): minutes is InstantAllowedDuration {
  return (INSTANT_ALLOWED_DURATIONS as readonly number[]).includes(minutes);
}
