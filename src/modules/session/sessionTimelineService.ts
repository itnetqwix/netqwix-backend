import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import { assertSessionParticipant } from "../../helpers/sessionAccess";
import { getLessonTimerSnapshot } from "../socket/socket.service";

const TIMELINE_SELECT =
  "status is_instant instant_phase booked_date session_start_time session_end_time start_time end_time extension_requests extensions both_joined_at accepted_at join_deadline_at createdAt updatedAt";

function buildTimelinePayload(bookingId: string, booking: any) {
  const timer = getLessonTimerSnapshot(bookingId);
  const extensionRequests = (booking.extension_requests || []).map((r: any) => ({
    requestId: String(r._id),
    status: r.status,
    minutes: r.minutes,
    amount: r.amount,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    paymentIntentId: r.payment_intent_id ?? null,
  }));
  const extensions = (booking.extensions || []).map((e: any) => ({
    minutes: e.minutes,
    amount: e.amount,
    appliedAt: e.applied_at,
    paymentIntentId: e.payment_intent_id ?? null,
  }));

  return {
    sessionId: bookingId,
    status: booking.status,
    isInstant: !!booking.is_instant,
    instantPhase: booking.instant_phase ?? null,
    bookedDate: booking.booked_date,
    sessionStart: booking.session_start_time,
    sessionEnd: booking.session_end_time,
    startTimeUtc: booking.start_time,
    endTimeUtc: booking.end_time,
    bothJoinedAt: booking.both_joined_at ?? null,
    acceptedAt: booking.accepted_at ?? null,
    joinDeadlineAt: booking.join_deadline_at ?? null,
    timer: timer
      ? {
          status: timer.status,
          remainingSeconds: timer.remainingSeconds,
          duration: timer.duration,
        }
      : null,
    extensionRequests,
    extensions,
    updatedAt: booking.updatedAt,
    createdAt: booking.createdAt,
  };
}

export async function getSessionTimeline(bookingId: string, userId: string) {
  if (!mongoose.isValidObjectId(bookingId)) {
    return { ok: false as const, code: 400, error: "Invalid session id." };
  }
  const access = await assertSessionParticipant(userId, bookingId);
  if (access.ok === false) {
    return { ok: false as const, code: access.code, error: access.error };
  }
  return getSessionTimelineById(bookingId);
}

/** Ops / admin — no participant check; booking must exist. */
export async function getSessionTimelineForAdmin(bookingId: string) {
  return getSessionTimelineById(bookingId);
}

async function getSessionTimelineById(bookingId: string) {
  if (!mongoose.isValidObjectId(bookingId)) {
    return { ok: false as const, code: 400, error: "Invalid session id." };
  }

  const booking = await booked_session
    .findById(bookingId)
    .select(TIMELINE_SELECT)
    .lean();

  if (!booking) {
    return { ok: false as const, code: 404, error: "Session not found." };
  }

  return {
    ok: true as const,
    timeline: buildTimelinePayload(bookingId, booking),
  };
}
