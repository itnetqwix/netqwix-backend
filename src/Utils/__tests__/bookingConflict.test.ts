/** Matrix B6/B7 — trainer/trainee slot overlap rejects double-booking */
import booked_session from "../../model/booked_sessions.schema";
import {
  checkBothPartiesBookingConflict,
  checkTrainerBookingConflict,
  checkTraineeBookingConflict,
} from "../bookingConflict";

jest.mock("../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

const mockFindOne = booked_session.findOne as jest.Mock;

describe("bookingConflict", () => {
  const start = new Date("2026-06-02T14:00:00.000Z");
  const end = new Date("2026-06-02T14:30:00.000Z");

  beforeEach(() => {
    mockFindOne.mockReset();
  });

  it("returns null when no overlapping booking exists", async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    expect(
      await checkTrainerBookingConflict("trainer-1", start, end)
    ).toBeNull();
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        trainer_id: "trainer-1",
        start_time: { $lt: end },
        end_time: { $gt: start },
      })
    );
  });

  it("returns trainer message when trainer has conflict", async () => {
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "existing" }),
    });
    const msg = await checkTrainerBookingConflict("trainer-1", start, end);
    expect(msg).toMatch(/trainer already has a booking/i);
  });

  it("returns trainee message when trainee has conflict", async () => {
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "existing" }),
    });
    const msg = await checkTraineeBookingConflict("trainee-1", start, end);
    expect(msg).toMatch(/already have a session/i);
  });

  it("prefers trainer conflict in checkBothParties", async () => {
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "existing" }),
    });
    const msg = await checkBothPartiesBookingConflict(
      "trainer-1",
      "trainee-1",
      start,
      end
    );
    expect(msg).toMatch(/trainer already has a booking/i);
  });

  it("excludes session id from conflict query when provided", async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await checkTrainerBookingConflict("trainer-1", start, end, "sess-abc");
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $ne: "sess-abc" },
      })
    );
  });
});
