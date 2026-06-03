import { DateTime } from "luxon";
import {
  computeJoinPolicy,
  intervalsOverlap,
  isScheduledSlotStartInPast,
  LIVE_LESSON_ERROR,
  mergeJoinPolicyWithCallSlot,
} from "../liveLessonRules";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { INSTANT_PHASE } from "../../config/instantLesson";

describe("liveLessonRules", () => {
  it("detects interval overlap", () => {
    const a0 = new Date("2026-06-02T14:00:00Z");
    const a1 = new Date("2026-06-02T14:30:00Z");
    const b0 = new Date("2026-06-02T14:15:00Z");
    const b1 = new Date("2026-06-02T15:00:00Z");
    expect(intervalsOverlap(a0, a1, b0, b1)).toBe(true);
    expect(intervalsOverlap(a0, a1, a1, b1)).toBe(false);
  });

  it("rejects past scheduled starts", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isScheduledSlotStartInPast(past)).toBe(true);
    expect(isScheduledSlotStartInPast(new Date(Date.now() + 60_000))).toBe(false);
  });

  it("blocks instant lesson awaiting accept", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const policy = computeJoinPolicy(
      {
        is_instant: true,
        status: BOOKED_SESSIONS_STATUS.BOOKED,
        instant_phase: INSTANT_PHASE.PENDING_ACCEPT,
        accept_deadline_at: new Date("2026-06-02T12:02:00Z"),
      },
      now
    );
    expect(policy.can_join).toBe(false);
    expect(policy.join_code).toBe(LIVE_LESSON_ERROR.AWAITING_ACCEPT);
  });

  it("allows scheduled join inside 15m early window", () => {
    const start = DateTime.fromISO("2026-06-02T15:00:00", { zone: "utc" });
    const now = start.minus({ minutes: 10 }).toJSDate();
    const policy = computeJoinPolicy(
      {
        is_instant: false,
        status: BOOKED_SESSIONS_STATUS.confirm,
        start_time: start.toJSDate(),
        end_time: start.plus({ hours: 1 }).toJSDate(),
      },
      now
    );
    expect(policy.can_join).toBe(true);
  });

  it("blocks scheduled join before early window", () => {
    const start = DateTime.fromISO("2026-06-02T15:00:00", { zone: "utc" });
    const now = start.minus({ minutes: 20 }).toJSDate();
    const policy = computeJoinPolicy(
      {
        is_instant: false,
        status: BOOKED_SESSIONS_STATUS.confirm,
        start_time: start.toJSDate(),
        end_time: start.plus({ hours: 1 }).toJSDate(),
      },
      now
    );
    expect(policy.can_join).toBe(false);
    expect(policy.join_code).toBe(LIVE_LESSON_ERROR.TOO_EARLY);
  });

  it("merges call-slot block when policy allows join", () => {
    const merged = mergeJoinPolicyWithCallSlot(
      { can_join: true, block_reason: null, join_code: null },
      { canJoin: false, reason: "already_active_elsewhere" }
    );
    expect(merged.can_join).toBe(false);
    expect(merged.block_reason).toMatch(/another device/i);
  });
});
