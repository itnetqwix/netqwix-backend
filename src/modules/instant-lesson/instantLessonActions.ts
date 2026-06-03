import { EVENTS, BOOKED_SESSIONS_STATUS } from "../../config/constance";
import {
  INSTANT_ACCEPT_WINDOW_MS,
  INSTANT_JOIN_AFTER_ACCEPT_MS,
  INSTANT_PHASE,
  INSTANT_REFUND_REASON,
} from "../../config/instantLesson";
import { checkTrainerBookingConflict } from "../../Utils/bookingConflict";
import {
  clearInstantLessonTimers,
  scheduleInstantLessonJoinExpiry,
} from "../../helpers/instantLessonExpiry";
import { refundSessionEscrow } from "../wallet/instantLessonRefundService";
import { publishSocketEventToUsers } from "../../services/eventPubSub";
import { MemCache } from "../../Utils/memCache";
import { getIo } from "../socket/socket.service";
import { runInstantLessonExpire } from "../socket/socket.service";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { logInstantLessonOps } from "../ops/opsInstantLogger";
import {
  INSTANT_NOTIFICATION,
  notifySessionUser,
} from "../session/sessionNotificationService";

export type InstantLessonActionResult =
  | {
      ok: true;
      acceptedAt: string;
      joinDeadlineAt: string;
      phase: string;
    }
  | { ok: false; error: string; message?: string };

function emitInstantLessonPhase(
  lessonId: string,
  coachId: string,
  traineeId: string,
  phase: string,
  extra: Record<string, unknown> = {}
) {
  void publishSocketEventToUsers(
    [coachId, traineeId],
    EVENTS.INSTANT_LESSON.PHASE,
    { lessonId, coachId, traineeId, phase, ...extra }
  );
}

function relayInstantEvent(
  event: string,
  coachId: string,
  traineeId: string,
  payload: Record<string, unknown>
) {
  const io = getIo();
  const coachSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, coachId);
  const traineeSocketId = MemCache.getDetail(process.env.SOCKET_CONFIG, traineeId);
  if (io && coachSocketId) {
    io.to(coachSocketId).emit(event, payload);
  }
  if (io && traineeSocketId) {
    io.to(traineeSocketId).emit(event, payload);
  }
}

export async function acceptInstantLessonAction(body: {
  lessonId: string;
  coachId: string;
  traineeId: string;
}): Promise<InstantLessonActionResult> {
  const { lessonId, coachId, traineeId } = body;
  if (!lessonId || !coachId || !traineeId) {
    return { ok: false, error: "missing_fields" };
  }

  const booking = await booked_session.findById(lessonId).lean();
  if (
    !booking?.is_instant ||
    String(booking.trainer_id) !== String(coachId) ||
    String(booking.trainee_id) !== String(traineeId) ||
    booking.status !== BOOKED_SESSIONS_STATUS.BOOKED
  ) {
    return { ok: false, error: "invalid_booking" };
  }

  const requestedAt = booking.createdAt
    ? new Date(booking.createdAt)
    : new Date(booking.booked_date);
  if (Date.now() - requestedAt.getTime() > INSTANT_ACCEPT_WINDOW_MS) {
    await runInstantLessonExpire(lessonId, coachId, traineeId, undefined, "accept");
    return { ok: false, error: "expired" };
  }

  const start = booking.start_time ? new Date(booking.start_time) : null;
  const end = booking.end_time ? new Date(booking.end_time) : null;
  if (start && end) {
    const conflictMsg = await checkTrainerBookingConflict(
      coachId,
      start,
      end,
      String(lessonId)
    );
    if (conflictMsg) {
      return { ok: false, error: "conflict", message: conflictMsg };
    }
  }

  const acceptedAt = new Date();
  const joinDeadlineAt = new Date(
    acceptedAt.getTime() + INSTANT_JOIN_AFTER_ACCEPT_MS
  );
  const updatedBooking = await booked_session.findOneAndUpdate(
    {
      _id: lessonId,
      is_instant: true,
      trainer_id: coachId,
      trainee_id: traineeId,
      status: BOOKED_SESSIONS_STATUS.BOOKED,
    },
    {
      $set: {
        status: BOOKED_SESSIONS_STATUS.confirm,
        accepted_at: acceptedAt,
        instant_phase: INSTANT_PHASE.PENDING_JOIN,
        join_deadline_at: joinDeadlineAt,
      },
    },
    { new: true }
  );

  if (!updatedBooking) {
    return { ok: false, error: "not_updated" };
  }

  clearInstantLessonTimers(lessonId);
  scheduleInstantLessonJoinExpiry(lessonId, coachId, traineeId, acceptedAt);

  const acceptPayload = {
    lessonId,
    coachId,
    traineeId,
    acceptedAt: acceptedAt.toISOString(),
    joinDeadlineAt: joinDeadlineAt.toISOString(),
    phase: INSTANT_PHASE.PENDING_JOIN,
  };

  emitInstantLessonPhase(
    lessonId,
    coachId,
    traineeId,
    INSTANT_PHASE.PENDING_JOIN,
    {
      acceptedAt: acceptedAt.toISOString(),
      joinDeadlineAt: joinDeadlineAt.toISOString(),
    }
  );

  relayInstantEvent(EVENTS.INSTANT_LESSON.ACCEPT, coachId, traineeId, acceptPayload);

  const coachUser = await user.findById(coachId).select("fullname").lean();
  const acceptedN = INSTANT_NOTIFICATION.accepted((coachUser as any)?.fullname);
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: acceptedN.title,
      description: acceptedN.description,
      bookingId: lessonId,
      kind: acceptedN.kind,
      extra: { joinDeadlineAt: joinDeadlineAt.toISOString() },
    },
    getIo()
  );

  logInstantLessonOps("INSTANT_LESSON_ACCEPT", {
    lessonId,
    coachId,
    traineeId,
    title: "Instant lesson accepted",
    payload: { acceptedAt: acceptedAt.toISOString(), via: "http" },
  });

  return {
    ok: true,
    acceptedAt: acceptedAt.toISOString(),
    joinDeadlineAt: joinDeadlineAt.toISOString(),
    phase: INSTANT_PHASE.PENDING_JOIN,
  };
}

export async function declineInstantLessonAction(body: {
  lessonId: string;
  coachId: string;
  traineeId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { lessonId, coachId, traineeId } = body;
  if (!lessonId || !coachId || !traineeId) {
    return { ok: false, error: "missing_fields" };
  }

  await booked_session.findOneAndUpdate(
    { _id: lessonId, is_instant: true, status: BOOKED_SESSIONS_STATUS.BOOKED },
    {
      $set: {
        status: BOOKED_SESSIONS_STATUS.cancel,
        instant_phase: INSTANT_PHASE.CANCELLED,
        refund_reason: INSTANT_REFUND_REASON.DECLINED,
      },
    }
  );
  clearInstantLessonTimers(lessonId);
  await refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.DECLINED);
  emitInstantLessonPhase(lessonId, coachId, traineeId, INSTANT_PHASE.CANCELLED, {
    refundReason: INSTANT_REFUND_REASON.DECLINED,
  });
  relayInstantEvent(EVENTS.INSTANT_LESSON.DECLINE, coachId, traineeId, {
    lessonId,
    coachId,
    traineeId,
  });

  const coachUser = await user.findById(coachId).select("fullname").lean();
  const declinedN = INSTANT_NOTIFICATION.declined((coachUser as any)?.fullname);
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: declinedN.title,
      description: declinedN.description,
      bookingId: lessonId,
      kind: declinedN.kind,
    },
    getIo()
  );

  logInstantLessonOps("INSTANT_LESSON_DECLINE", {
    lessonId,
    coachId,
    traineeId,
    severity: "warning",
    title: "Instant lesson declined",
    payload: { via: "http" },
  });

  return { ok: true };
}

/** Trainee cancels before coach accepts — escrow/card refund via unified path. */
export async function cancelInstantLessonByTraineeAction(body: {
  lessonId: string;
  traineeId: string;
}): Promise<{
  ok: boolean;
  error?: string;
  refund?: { refunded: boolean; error?: string };
}> {
  const { lessonId, traineeId } = body;
  if (!lessonId || !traineeId) {
    return { ok: false, error: "missing_fields" };
  }

  const booking = await booked_session.findById(lessonId).lean();
  if (!booking?.is_instant) {
    return { ok: false, error: "not_instant" };
  }
  if (String(booking.trainee_id) !== String(traineeId)) {
    return { ok: false, error: "forbidden" };
  }
  if (booking.status === BOOKED_SESSIONS_STATUS.cancel) {
    return { ok: true };
  }
  if (booking.accepted_at) {
    return { ok: false, error: "already_accepted" };
  }

  const coachId = String(booking.trainer_id);
  const updated = await booked_session.findOneAndUpdate(
    {
      _id: lessonId,
      is_instant: true,
      trainee_id: traineeId,
      status: BOOKED_SESSIONS_STATUS.BOOKED,
      accepted_at: { $exists: false },
    },
    {
      $set: {
        status: BOOKED_SESSIONS_STATUS.cancel,
        instant_phase: INSTANT_PHASE.CANCELLED,
        refund_reason: INSTANT_REFUND_REASON.TRAINEE_CANCELLED,
      },
    },
    { new: true }
  );

  if (!updated) {
    return { ok: false, error: "not_updated" };
  }

  clearInstantLessonTimers(lessonId);
  const refund = await refundSessionEscrow(
    lessonId,
    INSTANT_REFUND_REASON.TRAINEE_CANCELLED
  );

  emitInstantLessonPhase(lessonId, coachId, traineeId, INSTANT_PHASE.CANCELLED, {
    refundReason: INSTANT_REFUND_REASON.TRAINEE_CANCELLED,
  });
  relayInstantEvent(EVENTS.INSTANT_LESSON.TRAINEE_CANCELLED, coachId, traineeId, {
    lessonId,
    coachId,
    traineeId,
    refundReason: INSTANT_REFUND_REASON.TRAINEE_CANCELLED,
  });

  logInstantLessonOps("INSTANT_LESSON_TRAINEE_CANCELLED", {
    lessonId,
    coachId,
    traineeId,
    severity: "info",
    title: "Trainee cancelled instant lesson request",
    payload: { refunded: refund.refunded, via: "action" },
  });

  return { ok: true, refund };
}
