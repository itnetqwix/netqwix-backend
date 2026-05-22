import { DateTime } from "luxon";
import booked_session from "../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS, SessionReminderMinutes } from "../config/constance";
import {
  cancelBookingReminderJobs,
  scheduleBookingReminderJob,
} from "../queues/bookingReminderQueue";

/** Session start in UTC from booked_date + HH:mm:ss + IANA timezone. */
export function computeSessionStartUtc(booking: {
  booked_date: Date;
  session_start_time: string;
  time_zone?: string;
  start_time?: Date;
}): Date | null {
  if (booking.start_time) {
    return new Date(booking.start_time);
  }
  const tz = booking.time_zone || "UTC";
  const base = DateTime.fromJSDate(new Date(booking.booked_date), { zone: tz });
  const parts = String(booking.session_start_time || "00:00:00").split(":");
  const hour = Number(parts[0]) || 0;
  const minute = Number(parts[1]) || 0;
  const second = Number(parts[2]) || 0;
  const dt = base.set({ hour, minute, second, millisecond: 0 });
  if (!dt.isValid) return null;
  return dt.toUTC().toJSDate();
}

/** Schedule 15m + 5m push/email reminders when a scheduled session is confirmed. */
export async function scheduleSessionRemindersForBooking(
  sessionId: string
): Promise<void> {
  const row = await booked_session.findById(sessionId).lean();
  if (!row || row.is_instant) return;
  if (row.status !== BOOKED_SESSIONS_STATUS.confirm) return;

  const start = computeSessionStartUtc(row as any);
  if (!start) return;

  const startMs = start.getTime();
  const now = Date.now();
  if (startMs <= now) return;

  const at15 = new Date(startMs - SessionReminderMinutes.FIFTEEN * 60_000);
  const at5 = new Date(startMs - SessionReminderMinutes.FIVE * 60_000);

  if (at15.getTime() > now) {
    await scheduleBookingReminderJob(sessionId, "15m", at15);
  }
  if (at5.getTime() > now) {
    await scheduleBookingReminderJob(sessionId, "5m", at5);
  }
}

export async function cancelSessionReminders(sessionId: string): Promise<void> {
  await cancelBookingReminderJobs(sessionId);
}
