/** Matrix: B3, B4 — instant accept/decline */
import { BOOKED_SESSIONS_STATUS } from "../../../config/constance";
import { INSTANT_PHASE } from "../../../config/instantLesson";

jest.mock("../../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../../../model/user.schema", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../Utils/bookingConflict", () => ({
  checkTrainerBookingConflict: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../../helpers/instantLessonExpiry", () => ({
  clearInstantLessonTimers: jest.fn(),
  scheduleInstantLessonJoinExpiry: jest.fn(),
}));

jest.mock("../../wallet/instantLessonRefundService", () => ({
  refundSessionEscrow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../services/eventPubSub", () => ({
  publishSocketEventToUsers: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../socket/socket.service", () => ({
  getIo: jest.fn().mockReturnValue(null),
  runInstantLessonExpire: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../Utils/memCache", () => ({
  MemCache: { getDetail: jest.fn().mockReturnValue(null) },
}));

jest.mock("../../ops/opsInstantLogger", () => ({
  logInstantLessonOps: jest.fn(),
}));

jest.mock("../../session/sessionNotificationService", () => ({
  INSTANT_NOTIFICATION: {
    accepted: () => ({ title: "t", description: "d", kind: "instant" }),
    declined: () => ({ title: "t", description: "d", kind: "instant" }),
  },
  notifySessionUser: jest.fn(),
}));

import booked_session from "../../../model/booked_sessions.schema";
import user from "../../../model/user.schema";
import {
  acceptInstantLessonAction,
  declineInstantLessonAction,
} from "../instantLessonActions";

const mockFindById = booked_session.findById as jest.Mock;
const mockFindOneAndUpdate = booked_session.findOneAndUpdate as jest.Mock;
const mockUserFind = user.findById as jest.Mock;

describe("instantLessonActions", () => {
  const lessonId = "507f1f77bcf86cd799439011";
  const coachId = "507f1f77bcf86cd799439012";
  const traineeId = "507f1f77bcf86cd799439013";

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ fullname: "Coach" }),
      }),
    });
  });

  describe("acceptInstantLessonAction", () => {
    it("rejects missing fields", async () => {
      const r = await acceptInstantLessonAction({
        lessonId: "",
        coachId,
        traineeId,
      });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.error).toBe("missing_fields");
    });

    it("rejects invalid booking", async () => {
      mockFindById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      const r = await acceptInstantLessonAction({ lessonId, coachId, traineeId });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.error).toBe("invalid_booking");
    });

    it("accepts valid pending instant booking", async () => {
      const now = new Date();
      mockFindById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          is_instant: true,
          trainer_id: coachId,
          trainee_id: traineeId,
          status: BOOKED_SESSIONS_STATUS.BOOKED,
          createdAt: now,
          booked_date: now,
          start_time: new Date(now.getTime() + 3600_000),
          end_time: new Date(now.getTime() + 7200_000),
        }),
      });
      mockFindOneAndUpdate.mockResolvedValue({
        _id: lessonId,
        instant_phase: INSTANT_PHASE.PENDING_JOIN,
      });

      const r = await acceptInstantLessonAction({ lessonId, coachId, traineeId });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.phase).toBe(INSTANT_PHASE.PENDING_JOIN);
        expect(r.joinDeadlineAt).toBeTruthy();
      }
    });
  });

  describe("declineInstantLessonAction", () => {
    it("declines and returns ok", async () => {
      mockFindOneAndUpdate.mockResolvedValue({});
      const r = await declineInstantLessonAction({ lessonId, coachId, traineeId });
      expect(r.ok).toBe(true);
      expect(mockFindOneAndUpdate).toHaveBeenCalled();
    });
  });
});
