import { DateTime } from "luxon";
import { log } from "../../logger";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";
import booked_session from "../model/booked_sessions.schema";
import booking_reminder_log from "../model/booking_reminder_log.schema";
import { NotificationsService } from "../modules/notifications/notificationsService";
import { SendEmail } from "../Utils/sendEmail";

const logger = log.getLogger();
const pushService = new NotificationsService();

type ReminderKind = "h24" | "h1" | "m10" | "m1";

const KIND_OFFSETS: Record<ReminderKind, number> = {
  h24: 24 * 60,
  h1: 60,
  m10: 10,
  m1: 1,
};

const CADENCE_KINDS: Record<string, ReminderKind[]> = {
  off: [],
  minimal: ["h1"],
  standard: ["h24", "h1", "m10"],
  aggressive: ["h24", "h1", "m10", "m1"],
};

const KIND_COPY: Record<ReminderKind, { title: string; body: (when: string) => string }> = {
  h24: {
    title: "Session tomorrow",
    body: (when) => `Your NetQwix session is tomorrow at ${when}. Block your calendar — you're all set.`,
  },
  h1: {
    title: "Session in 1 hour",
    body: (when) => `Heads up — your NetQwix session starts at ${when}. Time to grab water and warm up.`,
  },
  m10: {
    title: "Session in 10 minutes",
    body: (when) => `Your NetQwix session starts at ${when}. Open the app to join.`,
  },
  m1: {
    title: "Starting now",
    body: () => "Your NetQwix session is starting. Tap to join.",
  },
};

/**
 * Cron-friendly reminder dispatcher. Runs once a minute and fires push
 * notifications at every configured cadence mark (24h / 1h / 10m / 1m).
 *
 * Strategy:
 *   1. Look ahead at all sessions confirmed for the next 25 hours
 *      (`booked_date` + `session_start_time` is the source of truth).
 *   2. For each, compute exact start instant in the session's time zone.
 *   3. For each cadence-mark, check whether the user's cadence preference
 *      opts them in AND we haven't already logged that mark for that user.
 *   4. Send push + write a log row in one upsert (unique index guarantees
 *      we never double-fire even under cron restarts).
 */
export async function processBookingReminders(): Promise<void> {
  try {
    const now = DateTime.utc();
    const horizonStart = now.minus({ minutes: 1 }).toJSDate();
    const horizonEnd = now.plus({ hours: 25 }).toJSDate();

    const sessions = await booked_session
      .find({
        status: { $in: [BOOKED_SESSIONS_STATUS.confirm, "booked"] },
        booked_date: { $gte: horizonStart, $lte: horizonEnd },
      })
      .populate({
        path: "trainee_id",
        select: "_id notifications fullname email",
      })
      .populate({
        path: "trainer_id",
        select: "_id notifications fullname email",
      })
      .lean();

    for (const session of sessions) {
      const startInstant = computeSessionStartInstant(session);
      if (!startInstant || !startInstant.isValid) continue;

      const minutesUntilStart = startInstant.diff(now, "minutes").minutes;

      for (const kind of Object.keys(KIND_OFFSETS) as ReminderKind[]) {
        const target = KIND_OFFSETS[kind];
        /**
         * Match the minute window — anywhere from "exactly target" down to
         * "target - 1" so transient cron lag still hits the mark instead
         * of skipping it forever.
         */
        if (minutesUntilStart > target || minutesUntilStart <= target - 1) continue;

        const when = startInstant
          .setZone(session.time_zone || "utc")
          .toFormat("h:mm a (ZZZZ)");
        const copy = KIND_COPY[kind];

        await fireReminder({
          sessionId: String(session._id),
          recipient: session.trainee_id as any,
          kind,
          title: copy.title,
          body: copy.body(when),
          when,
          session,
        });
        await fireReminder({
          sessionId: String(session._id),
          recipient: session.trainer_id as any,
          kind,
          title: copy.title,
          body: copy.body(when),
          when,
          session,
        });
      }
    }
  } catch (err) {
    logger.error("[bookingReminders] dispatcher error", err);
  }
}

function computeSessionStartInstant(session: any): DateTime | null {
  const tz = session.time_zone || "utc";
  const startStr = session.session_start_time;
  if (!startStr || typeof startStr !== "string") return null;
  const [hh, mm] = startStr.split(":").map((n: string) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dateOnly = DateTime.fromJSDate(session.booked_date).toUTC();
  const local = DateTime.fromObject(
    {
      year: dateOnly.year,
      month: dateOnly.month,
      day: dateOnly.day,
      hour: hh,
      minute: mm,
      second: 0,
    },
    { zone: tz }
  );
  if (!local.isValid) return null;
  return local.toUTC();
}

async function fireReminder(args: {
  sessionId: string;
  recipient: { _id?: any; notifications?: any; email?: string; fullname?: string } | null | undefined;
  kind: ReminderKind;
  title: string;
  body: string;
  when?: string;
  session?: any;
}): Promise<void> {
  const recipient = args.recipient;
  if (!recipient?._id) return;

  const cadence = String(
    recipient.notifications?.bookingReminderCadence ?? "standard"
  );
  const enabled = CADENCE_KINDS[cadence] ?? CADENCE_KINDS.standard;
  if (!enabled.includes(args.kind)) return;

  try {
    await booking_reminder_log.create({
      session_id: args.sessionId,
      user_id: recipient._id,
      kind: args.kind,
    });
  } catch (err: any) {
    /**
     * Duplicate-key error means we already sent this exact reminder.
     * Anything else is unexpected — log and bail without sending.
     */
    if (err?.code === 11000) return;
    logger.error("[bookingReminders] log insert failed", err);
    return;
  }

  try {
    await pushService.sendPushNotification(
      String(recipient._id),
      args.title,
      args.body,
      { kind: "booking_reminder", sessionId: args.sessionId, cadence: args.kind }
    );
  } catch (err) {
    logger.error("[bookingReminders] push send failed", err);
  }

  // Send email for 10-minute reminder (before_meeting) and 24-hour reminder
  if ((args.kind === "m10" || args.kind === "h24") && recipient.email && args.session) {
    try {
      const session = args.session;
      const trainerName = (session.trainer_id as any)?.fullname ?? "Your Expert";
      const traineeName = (session.trainee_id as any)?.fullname ?? "there";
      const isTrainer = String(recipient._id) === String((session.trainer_id as any)?._id);
      const recipientName = isTrainer ? trainerName : traineeName;
      const otherName = isTrainer ? traineeName : trainerName;
      const meetingLink = `${process.env.FRONTEND_URL_SMS}/meeting?id=${session._id}`;
      const when = args.when ?? "";
      const duration = session.session_end_time && session.session_start_time
        ? `${session.session_start_time} - ${session.session_end_time}`
        : "";

      if (args.kind === "m10") {
        SendEmail.sendRawEmail(
          "before_meeting",
          {
            "{FIRSTNAME}": recipientName.split(" ")[0] || recipientName,
            "{TRAINER_NAME}": otherName,
            "{MEETING_LINK}": meetingLink,
            "{SESSION_TIME}": when,
            "{SESSION_DURATION}": duration,
          },
          [recipient.email],
          `Your NetQwix session starts in 10 minutes`
        );
      } else if (args.kind === "h24") {
        SendEmail.sendRawEmail(
          "meeting_confirmed",
          {
            "{FIRSTNAME}": recipientName.split(" ")[0] || recipientName,
            "{TRAINER_NAME}": otherName,
            "{TRAINEE_NAME}": traineeName.split(" ")[0] || traineeName,
            "{MEETING_LINK}": meetingLink,
            "{SESSION_TIME}": when,
            "{SESSION_DURATION}": duration,
          },
          [recipient.email],
          `Your NetQwix session is tomorrow — ${when}`
        );
      }
    } catch (emailErr) {
      logger.error("[bookingReminders] email send failed", emailErr);
    }
  }
}
