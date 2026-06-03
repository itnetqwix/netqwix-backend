import { DateTime } from "luxon";
import {
  CovertTimeAccordingToTimeZone,
  isOverlap,
  Utils,
} from "../Utils/Utils";

export type TodaySlotsPreview = {
  count: number;
  /** Start times for browse chips (e.g. "4:30 PM"), max 3 from caller. */
  previews: string[];
  hasOpenSlots: boolean;
};

export type TrainerBookingWindow = {
  start: Date | string;
  end: Date | string;
  time_zone?: string;
};

/** Weekday key used in `availabilityInfo.availability` (Sun, Mon, …). */
export function dayOfWeekKeyFromIso(bookedDateIso: string): string {
  const date = DateTime.fromISO(bookedDateIso.split("T")[0], { zone: "utc" });
  return date.toFormat("ccc");
}

function parseSlotStartOnDate(
  bookedDateIso: string,
  slotStartLabel: string,
  zone: string
): DateTime | null {
  const dateOnly = bookedDateIso.split("T")[0];
  const dt = DateTime.fromFormat(
    `${dateOnly} ${slotStartLabel}`,
    "yyyy-MM-dd h:mm a",
    { zone }
  );
  if (dt.isValid) return dt;
  const dt24 = DateTime.fromFormat(
    `${dateOnly} ${slotStartLabel}`,
    "yyyy-MM-dd HH:mm",
    { zone }
  );
  return dt24.isValid ? dt24 : null;
}

function filterPastSlotsForToday(
  slots: Array<{ start: string; end: string }>,
  bookedDateIso: string,
  traineeTimeZone: string
): Array<{ start: string; end: string }> {
  const todayIso = DateTime.now().setZone(traineeTimeZone).toISODate();
  const dateOnly = bookedDateIso.split("T")[0];
  if (dateOnly !== todayIso) return slots;

  const now = DateTime.now().setZone(traineeTimeZone);
  return slots.filter((slot) => {
    const start = parseSlotStartOnDate(dateOnly, slot.start, traineeTimeZone);
    return start != null && start > now;
  });
}

function normalizeBookingsForOverlap(
  bookings: TrainerBookingWindow[],
  traineeTimeZone: string
): Array<{ start: Date; end: Date }> {
  return bookings.map((booking) => {
    let startTraineeTime = booking.start;
    let endTraineeTime = booking.end;
    const bookingTz = booking.time_zone;
    if (
      bookingTz &&
      traineeTimeZone !== bookingTz &&
      booking.start &&
      booking.end
    ) {
      startTraineeTime = new Date(
        CovertTimeAccordingToTimeZone(booking.start, {
          to: traineeTimeZone,
          from: bookingTz,
        }).ts
      );
      endTraineeTime = new Date(
        CovertTimeAccordingToTimeZone(booking.end, {
          to: traineeTimeZone,
          from: bookingTz,
        }).ts
      );
    }
    return {
      start: startTraineeTime instanceof Date ? startTraineeTime : new Date(startTraineeTime),
      end: endTraineeTime instanceof Date ? endTraineeTime : new Date(endTraineeTime),
    };
  });
}

/**
 * Bookable slot count and preview times for a single calendar day,
 * aligned with `checkSlotExist` (availability template + bookings).
 */
export function computeTodaySlotsPreviewFromAvailability(
  extraInfo: Record<string, unknown> | undefined,
  bookedDateIso: string,
  traineeTimeZone: string,
  existingBookings: TrainerBookingWindow[] = [],
  maxPreviews = 3
): TodaySlotsPreview {
  const availabilityInfo = extraInfo?.availabilityInfo as
    | {
        availability?: Record<string, Array<{ start: string; end: string }>>;
        timeZone?: string;
        selectedDuration?: number;
      }
    | undefined;

  if (!availabilityInfo?.availability || !availabilityInfo.timeZone) {
    return { count: 0, previews: [], hasOpenSlots: false };
  }

  const dayOfWeek = dayOfWeekKeyFromIso(bookedDateIso);
  const dayAvailability = availabilityInfo.availability[dayOfWeek] || [];
  if (!dayAvailability.length) {
    return { count: 0, previews: [], hasOpenSlots: false };
  }

  const timeSlots = Utils.generateTimeSlots(
    dayAvailability,
    availabilityInfo,
    bookedDateIso.split("T")[0],
    traineeTimeZone
  );

  const normalizedBookings = normalizeBookingsForOverlap(
    existingBookings,
    traineeTimeZone
  );

  let availableSlots = timeSlots.filter(
    (slot) =>
      !normalizedBookings.some((booking) => isOverlap(slot, booking))
  );

  availableSlots = filterPastSlotsForToday(
    availableSlots,
    bookedDateIso.split("T")[0],
    traineeTimeZone
  );

  return {
    count: availableSlots.length,
    previews: availableSlots.slice(0, maxPreviews).map((s) => s.start),
    hasOpenSlots: availableSlots.length > 0,
  };
}
