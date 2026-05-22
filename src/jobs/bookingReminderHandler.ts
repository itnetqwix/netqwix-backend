import booked_session from "../model/booked_sessions.schema";
import user from "../model/user.schema";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";
import { Utils } from "../Utils/Utils";
import { NotificationsService } from "../modules/notifications/notificationsService";
import type { BookingReminderJob } from "../queues/bookingReminderQueue";

const pushService = new NotificationsService();

/** Deliver a single booking reminder job (idempotent — skips if session no longer confirmed). */
export async function handleBookingReminderJob(
  job: BookingReminderJob
): Promise<void> {
  const session = await booked_session.findById(job.sessionId).lean();
  if (!session || session.is_instant) return;
  if (session.status !== BOOKED_SESSIONS_STATUS.confirm) return;

  const userIds = [
    String(session.trainee_id),
    String(session.trainer_id),
  ].filter(Boolean);

  const users = await user
    .find({ _id: { $in: userIds } })
    .select("_id fullname notifications")
    .lean();

  const startTime = Utils.convertToAmPm(session.session_start_time);
  const label =
    job.kind === "15m"
      ? "15 minutes"
      : job.kind === "5m"
        ? "5 minutes"
        : "soon";

  for (const u of users) {
    void pushService.sendPushNotification(
      String(u._id),
      "Session Reminder",
      `Your session starts in ${label} (at ${startTime}). Get ready!`,
      { kind: "session_reminder", sessionId: job.sessionId, reminderKind: job.kind }
    );
  }
}
