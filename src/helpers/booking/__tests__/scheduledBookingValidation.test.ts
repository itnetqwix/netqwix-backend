import { DateTime } from "luxon";
import {
  resolveScheduledUtcWindow,
  validateScheduledBookPayload,
  validateScheduledBookWindow,
} from "../scheduledBookingValidation";

describe("scheduledBookingValidation", () => {
  const base = {
    trainer_id: "507f1f77bcf86cd799439011",
    booked_date: "2026-12-01",
    session_start_time: "10:00",
    session_end_time: "11:00",
    charging_price: 50,
    time_zone: "America/New_York",
  };

  it("rejects missing fields", () => {
    expect(validateScheduledBookPayload({}).ok).toBe(false);
  });

  it("rejects invalid HH:mm", () => {
    const r = validateScheduledBookPayload({
      ...base,
      session_start_time: "25:99",
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/HH:mm/i);
  });

  it("requires payment when price > 0", () => {
    const r = validateScheduledBookPayload({ ...base, charging_price: 40 });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/payment/i);
  });

  it("allows wallet without PI", () => {
    expect(
      validateScheduledBookPayload({
        ...base,
        payment_method: "wallet",
        pin_session_token: "tok",
      } as any).ok
    ).toBe(true);
  });

  it("resolves overnight window", () => {
    const w = resolveScheduledUtcWindow({
      ...base,
      session_start_time: "23:00",
      session_end_time: "01:00",
    });
    expect(w).not.toBeNull();
    expect(w!.end_time.getTime()).toBeGreaterThan(w!.start_time.getTime());
  });

  it("rejects past slot start", () => {
    const r = validateScheduledBookWindow({
      ...base,
      booked_date: "2020-06-01",
      session_start_time: "08:00",
      session_end_time: "09:00",
      payment_method: "wallet",
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/already started/i);
  });
});
