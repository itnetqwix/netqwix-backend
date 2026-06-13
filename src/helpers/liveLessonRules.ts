/**
 * Server-side source of truth for live-lesson booking and join windows.
 * Keeps mobile/web aligned on instant + scheduled behaviour (matrix P4).
 */
import { BOOKED_SESSIONS_STATUS } from "../config/constance";
import { INSTANT_PHASE } from "../config/instantLesson";

export const LIVE_LESSON_JOIN = {
  EARLY_JOIN_MS: 15 * 60 * 1000,
  LATE_JOIN_MS: 15 * 60 * 1000,
} as const;

export const LIVE_LESSON_ERROR = {
  SLOT_IN_PAST: "slot_in_past",
  INVALID_TIMES: "invalid_times",
  TRAINER_CONFLICT: "trainer_conflict",
  TRAINEE_CONFLICT: "trainee_conflict",
  AWAITING_ACCEPT: "awaiting_accept",
  ACCEPT_EXPIRED: "accept_expired",
  JOIN_EXPIRED: "join_expired",
  TOO_EARLY: "too_early",
  SESSION_ENDED: "session_ended",
  CANCELLED: "cancelled",
  NOT_CONFIRMED: "not_confirmed",
} as const;

export type LiveLessonErrorCode =
  (typeof LIVE_LESSON_ERROR)[keyof typeof LIVE_LESSON_ERROR];

export function intervalsOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

/** Scheduled slot start must be strictly in the future. */
export function isScheduledSlotStartInPast(start: Date, now = new Date()): boolean {
  return start.getTime() <= now.getTime();
}

function toMs(v: unknown): number | null {
  if (v == null) return null;
  const ms = new Date(v as string | Date).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export type JoinPolicyInput = {
  is_instant?: boolean;
  status?: string;
  instant_phase?: string | null;
  accepted_at?: unknown;
  accept_deadline_at?: unknown;
  join_deadline_at?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  actual_end_at?: unknown;
  both_joined_at?: unknown;
  first_joined_at?: unknown;
};

export type JoinPolicy = {
  can_join: boolean;
  block_reason: string | null;
  join_code: LiveLessonErrorCode | null;
};

function cancelled(status?: string): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === BOOKED_SESSIONS_STATUS.cancel || s === "cancelled";
}

function confirmed(status?: string): boolean {
  const s = String(status ?? "").toLowerCase();
  return (
    s === BOOKED_SESSIONS_STATUS.confirm ||
    s === "confirmed" ||
    s === BOOKED_SESSIONS_STATUS.upcoming
  );
}

export function computeJoinPolicy(
  input: JoinPolicyInput,
  now = new Date()
): JoinPolicy {
  const nowMs = now.getTime();

  const actualEndMs = toMs(input.actual_end_at);
  if (actualEndMs != null && nowMs > actualEndMs) {
    return {
      can_join: false,
      block_reason: "This session has ended.",
      join_code: LIVE_LESSON_ERROR.SESSION_ENDED,
    };
  }

  if (cancelled(input.status)) {
    return {
      can_join: false,
      block_reason: "This session was cancelled.",
      join_code: LIVE_LESSON_ERROR.CANCELLED,
    };
  }

  if (input.is_instant) {
    const acceptDeadline = toMs(input.accept_deadline_at);
    const joinDeadline = toMs(input.join_deadline_at);
    const acceptedAt = toMs(input.accepted_at);
    const phase = String(input.instant_phase ?? "").toLowerCase();
    const live =
      !!input.both_joined_at ||
      !!input.first_joined_at ||
      phase === INSTANT_PHASE.ACTIVE;

    if (
      !acceptedAt &&
      (phase === INSTANT_PHASE.PENDING_ACCEPT ||
        input.status === BOOKED_SESSIONS_STATUS.BOOKED)
    ) {
      if (acceptDeadline != null && nowMs > acceptDeadline) {
        return {
          can_join: false,
          block_reason: "The coach did not accept this instant lesson in time.",
          join_code: LIVE_LESSON_ERROR.ACCEPT_EXPIRED,
        };
      }
      return {
        can_join: false,
        block_reason: "Waiting for the coach to accept this instant lesson.",
        join_code: LIVE_LESSON_ERROR.AWAITING_ACCEPT,
      };
    }

    if (
      acceptedAt &&
      !live &&
      (phase === INSTANT_PHASE.PENDING_JOIN || !input.both_joined_at)
    ) {
      if (joinDeadline != null && nowMs > joinDeadline) {
        return {
          can_join: false,
          block_reason: "The join window for this instant lesson has expired.",
          join_code: LIVE_LESSON_ERROR.JOIN_EXPIRED,
        };
      }
    }

    const endMs = toMs(input.end_time);
    if (live && endMs != null && nowMs > endMs + LIVE_LESSON_JOIN.LATE_JOIN_MS) {
      return {
        can_join: false,
        block_reason: "This instant lesson has ended.",
        join_code: LIVE_LESSON_ERROR.SESSION_ENDED,
      };
    }

    if (acceptedAt || live) {
      return { can_join: true, block_reason: null, join_code: null };
    }

    return {
      can_join: false,
      block_reason: "Instant lesson is not ready to join yet.",
      join_code: LIVE_LESSON_ERROR.NOT_CONFIRMED,
    };
  }

  if (!confirmed(input.status)) {
    return {
      can_join: false,
      block_reason: "Session is not confirmed yet.",
      join_code: LIVE_LESSON_ERROR.NOT_CONFIRMED,
    };
  }

  const startMs = toMs(input.start_time);
  const endMs = toMs(input.end_time);
  if (startMs == null || endMs == null) {
    return {
      can_join: false,
      block_reason: "Session times are not set.",
      join_code: LIVE_LESSON_ERROR.INVALID_TIMES,
    };
  }

  const openMs = startMs - LIVE_LESSON_JOIN.EARLY_JOIN_MS;
  const closeMs = endMs + LIVE_LESSON_JOIN.LATE_JOIN_MS;

  if (nowMs < openMs) {
    return {
      can_join: false,
      block_reason: "Join opens 15 minutes before the scheduled start.",
      join_code: LIVE_LESSON_ERROR.TOO_EARLY,
    };
  }

  if (nowMs > closeMs) {
    return {
      can_join: false,
      block_reason: "This scheduled session has ended.",
      join_code: LIVE_LESSON_ERROR.SESSION_ENDED,
    };
  }

  return { can_join: true, block_reason: null, join_code: null };
}

/** Combine booking policy with device call-slot (second device) gate. */
export function mergeJoinPolicyWithCallSlot(
  policy: JoinPolicy,
  callSlot: { canJoin: boolean; reason?: string }
): JoinPolicy {
  if (!policy.can_join) return policy;
  if (callSlot.canJoin) return policy;
  return {
    can_join: false,
    block_reason:
      callSlot.reason === "already_active_elsewhere"
        ? "You are already in this lesson on another device."
        : "Unable to join from this device right now.",
    join_code: null,
  };
}
