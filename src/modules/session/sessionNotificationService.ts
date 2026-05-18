import notification from "../../model/notifications.schema";
import user from "../../model/user.schema";
import { NotificationType } from "../../enum/notification.enum";
import { NotificationsService } from "../notifications/notificationsService";
import { EVENTS } from "../../config/constance";

const pushService = new NotificationsService();

export type SessionNotifyPayload = {
  receiverId: string;
  senderId?: string;
  title: string;
  description: string;
  bookingId: string;
  kind: string;
  extra?: Record<string, unknown>;
};

/** Persist inbox row + push + socket receive (when io available). */
export async function notifySessionUser(
  payload: SessionNotifyPayload,
  ioInstance?: { to: (room: string) => { emit: (event: string, data: unknown) => void } } | null
) {
  const { receiverId, senderId, title, description, bookingId, kind, extra } = payload;
  if (!receiverId) return;

  const sender = senderId
    ? await user.findById(senderId).select("fullname profile_picture").lean()
    : null;

  const doc = await notification.create({
    title,
    description,
    senderId: senderId || receiverId,
    receiverId,
    type: NotificationType.TRANSCATIONAL,
  });

  const receivePayload = {
    _id: doc?._id,
    title: doc?.title,
    description: doc?.description,
    createdAt: doc?.createdAt,
    isRead: doc?.isRead,
    sender: sender
      ? {
          _id: sender._id,
          name: (sender as any).fullname,
          profile_picture: (sender as any).profile_picture || null,
        }
      : undefined,
    bookingInfo: { bookingId, lessonId: bookingId, kind, ...extra },
  };

  try {
    const { MemCache } = require("../../Utils/memCache");
    const socketId = MemCache.getDetail(process.env.SOCKET_CONFIG, receiverId);
    if (socketId && ioInstance) {
      ioInstance.to(socketId).emit(EVENTS.PUSH_NOTIFICATIONS.ON_RECEIVE, receivePayload);
    }
  } catch {
    /* optional */
  }

  void pushService.sendPushNotification(receiverId, title, description, {
    bookingId,
    lessonId: bookingId,
    kind,
    ...extra,
  });
}

export const INSTANT_NOTIFICATION = {
  acceptExpiredTrainee: (trainerName: string) => ({
    title: "Instant lesson expired",
    description: `${trainerName || "The coach"} did not accept in time. Your payment will be returned to your wallet.`,
    kind: "instant_lesson_accept_expired",
  }),
  acceptExpiredTrainer: (traineeName: string) => ({
    title: "Instant request expired",
    description: `The instant lesson request from ${traineeName || "a trainee"} expired.`,
    kind: "instant_lesson_accept_expired_trainer",
  }),
  declined: (trainerName: string) => ({
    title: "Instant lesson declined",
    description: `${trainerName || "The coach"} declined your instant lesson request.`,
    kind: "instant_lesson_declined",
  }),
  accepted: (trainerName: string) => ({
    title: "Instant lesson accepted",
    description: `${trainerName || "Your coach"} accepted. Join within 2 minutes.`,
    kind: "instant_lesson_accepted",
  }),
  joinReminder: (otherName: string) => ({
    title: "Join your lesson now",
    description: `${otherName || "Your partner"} is waiting. You have 2 minutes to join.`,
    kind: "instant_lesson_join_reminder",
  }),
  joinExpired: () => ({
    title: "Lesson did not start",
    description:
      "The join window closed. Your payment will be returned to your wallet if it was held in escrow.",
    kind: "instant_lesson_join_expired",
  }),
  refundProcessed: () => ({
    title: "Refund processed",
    description: "Your lesson payment has been returned to your wallet.",
    kind: "instant_lesson_refund",
  }),
  scheduledConfirmed: (trainerName: string) => ({
    title: "Session confirmed",
    description: `${trainerName || "Your coach"} confirmed your scheduled session.`,
    kind: "scheduled_confirmed",
  }),
  scheduledCancelled: (who: string) => ({
    title: "Session cancelled",
    description: `${who || "A session"} was cancelled.`,
    kind: "scheduled_cancelled",
  }),
};
