/** Matrix: P1 — join readiness */
import mongoose from "mongoose";

jest.mock("../../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: { aggregate: jest.fn() },
}));

jest.mock("../../socket/lessonCallSlotStore", () => ({
  getLessonCallSlotStatus: jest.fn().mockResolvedValue({
    canJoin: true,
    reason: null,
    canTakeOver: false,
  }),
}));

jest.mock("../../socket/socket.service", () => ({
  getLessonTimerSnapshot: jest.fn().mockReturnValue({
    remainingSeconds: 900,
    status: "running",
  }),
}));

jest.mock("../../trainee/sessionExtensionService", () => ({
  SessionExtensionService: jest.fn().mockImplementation(() => ({
    getQuote: jest.fn().mockResolvedValue({
      result: { amount: 12, allowed: true },
    }),
  })),
}));

import booked_session from "../../../model/booked_sessions.schema";
import { getSessionJoinReadiness } from "../sessionJoinReadinessService";

const mockAggregate = booked_session.aggregate as jest.Mock;

describe("sessionJoinReadinessService", () => {
  const bookingId = new mongoose.Types.ObjectId().toString();
  const trainerId = new mongoose.Types.ObjectId().toString();
  const traineeId = new mongoose.Types.ObjectId().toString();

  it("returns null for invalid booking id", async () => {
    expect(await getSessionJoinReadiness("bad", trainerId, "Trainer")).toBeNull();
  });

  it("returns null when user is not a participant", async () => {
    mockAggregate.mockResolvedValue([
      {
        _id: bookingId,
        trainer_id: trainerId,
        trainee_id: traineeId,
        status: "confirm",
        is_instant: true,
        instant_phase: "pending_join",
        trainee_clips: [],
        trainer_info: { _id: trainerId, fullname: "Coach" },
        trainee_info: { _id: traineeId, fullname: "Trainee" },
      },
    ]);
    const r = await getSessionJoinReadiness(bookingId, "other-user", "Trainer");
    expect(r).toBeNull();
  });

  it("returns readiness for trainee with extension preview", async () => {
    mockAggregate.mockResolvedValue([
      {
        _id: bookingId,
        trainer_id: trainerId,
        trainee_id: traineeId,
        status: "booked",
        is_instant: true,
        instant_phase: "pending_accept",
        accept_deadline_at: new Date(Date.now() + 60_000),
        duration_minutes: 30,
        trainee_clips: [],
        trainer_info: { _id: trainerId, fullname: "Coach" },
        trainee_info: { _id: traineeId, fullname: "Trainee" },
        iceServers: [],
      },
    ]);
    const r = await getSessionJoinReadiness(bookingId, traineeId, "Trainee");
    expect(r).toMatchObject({
      sessionId: bookingId,
      is_instant: true,
      lesson_client_requirement: "native_app",
      mixed_client_warning: null,
      join_policy: expect.objectContaining({ join_code: expect.any(String) }),
    });
    expect(r?.can_join).toBe(false);
    expect(r?.join_code).toBe("awaiting_accept");
    expect(r?.extension_preview?.allowed).toBe(true);
    expect(r?.peer?.role).toBe("trainer");
  });

  it("omits extension quote for trainer", async () => {
    mockAggregate.mockResolvedValue([
      {
        _id: bookingId,
        trainer_id: trainerId,
        trainee_id: traineeId,
        status: "confirm",
        is_instant: false,
        session_start_time: "10:00",
        session_end_time: "11:00",
        time_zone: "America/New_York",
        trainee_clips: [],
        trainer_info: { _id: trainerId, fullname: "Coach" },
        trainee_info: { _id: traineeId, fullname: "Trainee" },
        iceServers: [],
      },
    ]);
    const r = await getSessionJoinReadiness(bookingId, trainerId, "Trainer");
    expect(r?.is_instant).toBe(false);
    expect(r?.extension_preview?.allowed).toBe(false);
  });
});
