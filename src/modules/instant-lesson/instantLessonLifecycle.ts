/**
 * Instant lesson accept/join expiry — shared by REST, socket, cron, and queues.
 */

import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { EVENTS, BOOKED_SESSIONS_STATUS } from "../../config/constance";
import {
  INSTANT_PHASE,
  INSTANT_REFUND_REASON,
} from "../../config/instantLesson";
import { clearInstantLessonTimers } from "../../helpers/instantLessonExpiry";
import { refundSessionEscrow } from "../wallet/instantLessonRefundService";
import { publishSocketEventToUsers } from "../socket/socketEmit";
import { logInstantLessonOps } from "../ops/opsInstantLogger";
import {
  INSTANT_NOTIFICATION,
  notifySessionUser,
} from "../session/sessionNotificationService";
import { isUserOnline } from "../socket/socket.service";

function getPushService() {
  const { NotificationsService } = require("../notifications/notificationsService");
  return new NotificationsService();
}

function getIoInstance() {
  const { getIo } = require("../socket/socket.service");
  return getIo();
}

async function emitInstantLessonExpire(
  lessonId: string,
  coachId: string,
  traineeId: string
) {
  const payload = { lessonId, coachId, traineeId };
  void publishSocketEventToUsers([coachId, traineeId], EVENTS.INSTANT_LESSON.EXPIRE, payload);
  if (traineeId && !isUserOnline(traineeId)) {
    void getPushService().sendPushNotification(
      traineeId,
      "Lesson Expired",
      "Your instant lesson request expired. The trainer didn't respond in time.",
      { kind: "instant_lesson_expire", lessonId }
    );
  }
}

function emitInstantLessonPhase(
  lessonId: string,
  coachId: string,
  traineeId: string,
  phase: string,
  extra: Record<string, unknown> = {}
) {
  const payload = { lessonId, coachId, traineeId, phase, ...extra };
  void publishSocketEventToUsers([coachId, traineeId], EVENTS.INSTANT_LESSON.PHASE, payload);
}

async function notifyInstantAcceptExpired(
  lessonId: string,
  coachId: string,
  traineeId: string
) {
  const [trainer, trainee] = await Promise.all([
    user.findById(coachId).select("fullname").lean(),
    user.findById(traineeId).select("fullname").lean(),
  ]);
  const trainerName = (trainer as any)?.fullname;
  const traineeName = (trainee as any)?.fullname;
  const nTrainee = INSTANT_NOTIFICATION.acceptExpiredTrainee(trainerName);
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: nTrainee.title,
      description: nTrainee.description,
      bookingId: lessonId,
      kind: nTrainee.kind,
    },
    getIoInstance()
  );
  const nTrainer = INSTANT_NOTIFICATION.acceptExpiredTrainer(traineeName);
  void notifySessionUser(
    {
      receiverId: coachId,
      senderId: traineeId,
      title: nTrainer.title,
      description: nTrainer.description,
      bookingId: lessonId,
      kind: nTrainer.kind,
    },
    getIoInstance()
  );
}

async function notifyInstantJoinExpired(
  lessonId: string,
  coachId: string,
  traineeId: string
) {
  const n = INSTANT_NOTIFICATION.joinExpired();
  const io = getIoInstance();
  void notifySessionUser(
    {
      receiverId: traineeId,
      senderId: coachId,
      title: n.title,
      description: n.description,
      bookingId: lessonId,
      kind: n.kind,
    },
    io
  );
  void notifySessionUser(
    {
      receiverId: coachId,
      senderId: traineeId,
      title: n.title,
      description: n.description,
      bookingId: lessonId,
      kind: n.kind,
    },
    io
  );
}

export async function runInstantLessonExpire(
  lessonId: string,
  coachId?: string,
  traineeId?: string,
  _originatingSocket?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } },
  kind: "accept" | "join" = "accept"
) {
  try {
    const booking = await booked_session.findById(lessonId).lean();
    if (!booking?.is_instant) return;

    const resolvedCoachId = coachId || String(booking.trainer_id);
    const resolvedTraineeId = traineeId || String(booking.trainee_id);

    if (kind === "accept" && booking.status === BOOKED_SESSIONS_STATUS.BOOKED) {
      await booked_session.findOneAndUpdate(
        { _id: lessonId, is_instant: true, status: BOOKED_SESSIONS_STATUS.BOOKED },
        {
          $set: {
            status: BOOKED_SESSIONS_STATUS.cancel,
            instant_phase: INSTANT_PHASE.CANCELLED,
            refund_reason: INSTANT_REFUND_REASON.ACCEPT_EXPIRED,
          },
        }
      );
      void refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.ACCEPT_EXPIRED);
      await emitInstantLessonExpire(lessonId, resolvedCoachId, resolvedTraineeId);
      emitInstantLessonPhase(
        lessonId,
        resolvedCoachId,
        resolvedTraineeId,
        INSTANT_PHASE.CANCELLED,
        { refundReason: INSTANT_REFUND_REASON.ACCEPT_EXPIRED }
      );
      logInstantLessonOps("INSTANT_LESSON_EXPIRED", {
        lessonId,
        coachId: resolvedCoachId,
        traineeId: resolvedTraineeId,
        severity: "warning",
        title: "Instant lesson accept window expired",
        summary: "Trainer did not accept in time; booking cancelled and refund initiated.",
      });
      void notifyInstantAcceptExpired(lessonId, resolvedCoachId, resolvedTraineeId);
    }

    if (
      kind === "join" &&
      booking.status === BOOKED_SESSIONS_STATUS.confirm &&
      !(booking as any).both_joined_at
    ) {
      await booked_session.findOneAndUpdate(
        {
          _id: lessonId,
          is_instant: true,
          status: BOOKED_SESSIONS_STATUS.confirm,
          both_joined_at: null,
        },
        {
          $set: {
            status: BOOKED_SESSIONS_STATUS.cancel,
            instant_phase: INSTANT_PHASE.CANCELLED,
            refund_reason: INSTANT_REFUND_REASON.JOIN_EXPIRED,
          },
        }
      );
      void refundSessionEscrow(lessonId, INSTANT_REFUND_REASON.JOIN_EXPIRED);
      emitInstantLessonPhase(
        lessonId,
        resolvedCoachId,
        resolvedTraineeId,
        INSTANT_PHASE.CANCELLED,
        { refundReason: INSTANT_REFUND_REASON.JOIN_EXPIRED }
      );
      logInstantLessonOps("INSTANT_LESSON_JOIN_EXPIRED", {
        lessonId,
        coachId: resolvedCoachId,
        traineeId: resolvedTraineeId,
        severity: "warning",
        title: "Instant lesson join window expired",
        summary: "Parties did not join in time; refund initiated.",
      });
      void notifyInstantJoinExpired(lessonId, resolvedCoachId, resolvedTraineeId);
    }
  } catch {
    /* non-fatal */
  } finally {
    clearInstantLessonTimers(lessonId);
  }
}
