/**
 * Pure scheduled-booking validation extracted from bookSessionCore (testable, P5/P6).
 */
import { DateTime } from "luxon";
import { timeRegex } from "../../config/constance";
import { isScheduledSlotStartInPast } from "../liveLessonRules";

export type ScheduledBookPayloadInput = {
  trainer_id?: string;
  booked_date?: string | Date;
  session_start_time?: string | number;
  session_end_time?: string | number;
  charging_price?: number | null;
  time_zone?: string;
  payment_method?: string;
  payment_intent_id?: string;
  coupon_code?: string;
};

export type ValidationFail = { ok: false; message: string; httpCode?: number };
export type ValidationOk = { ok: true };
export type ValidationResult = ValidationOk | ValidationFail;

const PAYMENT_METHODS = new Set(["wallet", "card"]);

export function validateScheduledBookPayload(
  payload: ScheduledBookPayloadInput | null | undefined
): ValidationResult {
  if (
    !payload?.trainer_id ||
    !payload.booked_date ||
    payload.session_start_time == null ||
    payload.session_end_time == null ||
    payload.charging_price == null ||
    !payload.time_zone
  ) {
    return { ok: false, message: "Invalid input data", httpCode: 400 };
  }

  const startStr = String(payload.session_start_time);
  const endStr = String(payload.session_end_time);
  if (!timeRegex.test(startStr) || !timeRegex.test(endStr)) {
    return {
      ok: false,
      message: "Invalid time format. Please use HH:mm format.",
      httpCode: 400,
    };
  }

  if (Number(payload.charging_price) < 0) {
    return { ok: false, message: "Invalid session price.", httpCode: 400 };
  }

  if (payload.payment_method != null && payload.payment_method !== "") {
    if (!PAYMENT_METHODS.has(String(payload.payment_method))) {
      return {
        ok: false,
        message: "payment_method must be wallet or card.",
        httpCode: 400,
      };
    }
  }

  if (
    Number(payload.charging_price) > 0 &&
    !payload.payment_intent_id &&
    payload.payment_method !== "wallet" &&
    !payload.coupon_code?.trim()
  ) {
    return {
      ok: false,
      message: "Payment is required before booking.",
      httpCode: 400,
    };
  }

  return { ok: true };
}

export function resolveScheduledUtcWindow(
  payload: ScheduledBookPayloadInput
): { start_time: Date; end_time: Date } | null {
  if (!payload?.booked_date || !payload.time_zone) return null;
  try {
    const rawDate =
      typeof payload.booked_date === "string"
        ? payload.booked_date.split("T")[0]
        : new Date(payload.booked_date as Date).toISOString().split("T")[0];
    const sessionStartTime = String(payload.session_start_time);
    const sessionEndTime = String(payload.session_end_time);
    const [startH, startM] = sessionStartTime.split(":").map(Number);
    const [endH, endM] = sessionEndTime.split(":").map(Number);
    const parts = rawDate.split("-").map(Number);
    const startDT = DateTime.fromObject(
      {
        year: parts[0],
        month: parts[1],
        day: parts[2],
        hour: startH,
        minute: startM,
        second: 0,
      },
      { zone: payload.time_zone }
    );
    let endDT = DateTime.fromObject(
      {
        year: parts[0],
        month: parts[1],
        day: parts[2],
        hour: endH,
        minute: endM,
        second: 0,
      },
      { zone: payload.time_zone }
    );
    if (endDT <= startDT) endDT = endDT.plus({ days: 1 });
    if (!startDT.isValid || !endDT.isValid) return null;
    return { start_time: startDT.toJSDate(), end_time: endDT.toJSDate() };
  } catch {
    return null;
  }
}

export function validateScheduledBookWindow(
  payload: ScheduledBookPayloadInput
): ValidationResult {
  const base = validateScheduledBookPayload(payload);
  if (base.ok === false) return base;

  const window = resolveScheduledUtcWindow(payload);
  if (!window) {
    return {
      ok: false,
      message:
        "Could not resolve session start and end times. Check date, times, and timezone.",
      httpCode: 400,
    };
  }
  if (isScheduledSlotStartInPast(window.start_time)) {
    return {
      ok: false,
      message: "Cannot book a session slot that has already started.",
      httpCode: 400,
    };
  }
  return { ok: true };
}
