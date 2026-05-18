import { DateTime } from "luxon";
import user from "../../model/user.schema";
import schedule_inventory from "../../model/schedule_inventory.schema";
import {
  computeInstantReservationWindowMs,
  isInstantAllowedDuration,
} from "../../config/instantLesson";
import { isUserOnline } from "../socket/socket.service";
import {
  checkBothPartiesBookingConflict,
} from "../../Utils/bookingConflict";

export type InstantEligibilityResult = {
  eligible: boolean;
  reasons: string[];
  durationMinutes: number;
  totalWindowMinutes: number;
  acceptDeadlinePreview?: string;
  trainerTimezone?: string;
};

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function resolveTrainerTimezone(trainer: {
  time_zone?: string;
  extraInfo?: { availabilityInfo?: { timeZone?: string } };
}): string {
  return (
    trainer?.extraInfo?.availabilityInfo?.timeZone ||
    (trainer as { time_zone?: string }).time_zone ||
    "America/New_York"
  );
}

/** Whether `now` falls inside the trainer's weekly availability template (trainer TZ). */
export async function isTrainerInWeeklyAvailabilityNow(
  trainerId: string,
  now: Date = new Date()
): Promise<{ ok: boolean; timezone: string }> {
  const trainer = await user
    .findById(trainerId)
    .select("time_zone extraInfo.availabilityInfo")
    .lean();
  if (!trainer) return { ok: false, timezone: "America/New_York" };

  const tz = resolveTrainerTimezone(trainer as any);
  const local = DateTime.fromJSDate(now, { zone: tz });
  const dayName = local.weekdayLong?.toLowerCase() ?? "";
  const nowMinutes = local.hour * 60 + local.minute;

  const schedule = await schedule_inventory.findOne({ trainer_id: trainerId }).lean();
  if (!schedule?.available_slots?.length) {
    return { ok: false, timezone: tz };
  }

  const dayEntry = schedule.available_slots.find(
    (d: { day?: string }) => (d.day || "").toLowerCase() === dayName
  );
  if (!dayEntry?.slots?.length) return { ok: false, timezone: tz };

  for (const slot of dayEntry.slots) {
    if (!slot.start_time || !slot.end_time) continue;
    const [sh, sm] = slot.start_time.split(":").map(Number);
    const [eh, em] = slot.end_time.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) continue;
    const startM = sh * 60 + sm;
    const endM = eh * 60 + em;
    if (nowMinutes >= startM && nowMinutes < endM) {
      return { ok: true, timezone: tz };
    }
  }

  return { ok: false, timezone: tz };
}

export async function checkInstantLessonEligibility(params: {
  trainerId: string;
  traineeId: string;
  durationMinutes: number;
  now?: Date;
}): Promise<InstantEligibilityResult> {
  const { trainerId, traineeId, durationMinutes } = params;
  const now = params.now ?? new Date();
  const reasons: string[] = [];

  if (!isInstantAllowedDuration(durationMinutes)) {
    return {
      eligible: false,
      reasons: ["Instant lessons are only available for 15 or 30 minutes."],
      durationMinutes,
      totalWindowMinutes: 0,
    };
  }

  const totalMs = computeInstantReservationWindowMs(durationMinutes);
  const totalWindowMinutes = Math.ceil(totalMs / 60_000);
  const windowEnd = new Date(now.getTime() + totalMs);
  const acceptDeadlinePreview = new Date(
    now.getTime() + 2 * 60 * 1000
  ).toISOString();

  const trainer = await user
    .findById(trainerId)
    .select("showAsOnline time_zone extraInfo.availabilityInfo")
    .lean();

  if (!trainer) {
    reasons.push("Trainer not found.");
  } else {
    if (!isUserOnline(trainerId)) {
      reasons.push("Coach is not online right now.");
    }
    if ((trainer as any).showAsOnline === false) {
      reasons.push("Coach is not available for instant lessons.");
    }
    const avail = await isTrainerInWeeklyAvailabilityNow(trainerId, now);
    if (!avail.ok) {
      reasons.push("Coach is outside their availability hours.");
    }
  }

  const conflictMsg = await checkBothPartiesBookingConflict(
    trainerId,
    traineeId,
    now,
    windowEnd
  );
  if (conflictMsg) reasons.push(conflictMsg);

  return {
    eligible: reasons.length === 0,
    reasons,
    durationMinutes,
    totalWindowMinutes,
    acceptDeadlinePreview,
    trainerTimezone: trainer
      ? resolveTrainerTimezone(trainer as any)
      : undefined,
  };
}

export const instantEligibilityService = {
  checkInstantLessonEligibility,
  isTrainerInWeeklyAvailabilityNow,
};
