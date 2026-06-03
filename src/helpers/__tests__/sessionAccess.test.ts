/** Matrix: B7 — scheduled duration validation */
import mongoose from "mongoose";
import {
  assertTrainerOwnsSession,
  assertSessionParticipant,
  computeScheduledDurationMinutes,
} from "../sessionAccess";

jest.mock("../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}));

import booked_session from "../../model/booked_sessions.schema";

const mockFindById = booked_session.findById as jest.Mock;

describe("sessionAccess", () => {
  beforeEach(() => {
    mockFindById.mockReset();
  });

  describe("computeScheduledDurationMinutes", () => {
    it("computes same-day slot length", () => {
      expect(computeScheduledDurationMinutes("09:00", "10:00")).toBe(60);
      expect(computeScheduledDurationMinutes("09:30", "10:00")).toBe(30);
    });

    it("wraps overnight slots", () => {
      expect(computeScheduledDurationMinutes("23:00", "01:00")).toBe(120);
    });
  });

  describe("assertSessionParticipant", () => {
    it("rejects invalid session id", async () => {
      const r = await assertSessionParticipant("user1", "not-an-id");
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.code).toBe(400);
    });

    it("allows trainer on own session", async () => {
      const trainerId = new mongoose.Types.ObjectId().toString();
      const traineeId = new mongoose.Types.ObjectId().toString();
      const sessionId = new mongoose.Types.ObjectId().toString();
      mockFindById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            trainer_id: trainerId,
            trainee_id: traineeId,
            is_instant: false,
            status: "confirm",
          }),
        }),
      });
      const r = await assertSessionParticipant(trainerId, sessionId, ["trainer"]);
      expect(r.ok).toBe(true);
    });

    it("rejects trainee calling trainer-only endpoint", async () => {
      const trainerId = new mongoose.Types.ObjectId().toString();
      const traineeId = new mongoose.Types.ObjectId().toString();
      const sessionId = new mongoose.Types.ObjectId().toString();
      mockFindById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            trainer_id: trainerId,
            trainee_id: traineeId,
          }),
        }),
      });
      const r = await assertSessionParticipant(traineeId, sessionId, ["trainer"]);
      expect(r.ok).toBe(false);
    });
  });

  describe("assertTrainerOwnsSession", () => {
    it("rejects trainee mismatch", async () => {
      const trainerId = new mongoose.Types.ObjectId().toString();
      const traineeId = new mongoose.Types.ObjectId().toString();
      const otherTrainee = new mongoose.Types.ObjectId().toString();
      const sessionId = new mongoose.Types.ObjectId().toString();
      mockFindById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            trainer_id: trainerId,
            trainee_id: traineeId,
          }),
        }),
      });
      const r = await assertTrainerOwnsSession(trainerId, sessionId, otherTrainee);
      expect(r.ok).toBe(false);
    });
  });
});
