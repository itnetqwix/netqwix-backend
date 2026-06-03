jest.mock("../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}));

jest.mock("../../modules/wallet/instantLessonRefundService", () => ({
  refundSessionEscrow: jest.fn(),
}));

import booked_session from "../../model/booked_sessions.schema";
import { refundSessionEscrow } from "../../modules/wallet/instantLessonRefundService";
import { processScheduledNoShowRefunds } from "../scheduledNoShowJob";

const mockFind = booked_session.find as jest.Mock;
const mockUpdate = booked_session.findByIdAndUpdate as jest.Mock;
const mockRefund = refundSessionEscrow as jest.Mock;

describe("processScheduledNoShowRefunds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefund.mockResolvedValue({ refunded: true });
    mockUpdate.mockResolvedValue({});
  });

  it("refunds confirmed scheduled sessions past join grace", async () => {
    const pastStart = new Date(Date.now() - 60 * 60 * 1000);
    mockFind.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "s1",
            is_instant: false,
            start_time: pastStart,
            both_joined_at: null,
          },
        ]),
      }),
    });

    const count = await processScheduledNoShowRefunds();
    expect(count).toBe(1);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockRefund).toHaveBeenCalledWith("s1", "scheduled_trainer_no_show");
  });

  it("skips sessions still inside grace window", async () => {
    const recentStart = new Date(Date.now() - 5 * 60 * 1000);
    mockFind.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "s2",
            start_time: recentStart,
            both_joined_at: null,
          },
        ]),
      }),
    });

    const count = await processScheduledNoShowRefunds();
    expect(count).toBe(0);
    expect(mockRefund).not.toHaveBeenCalled();
  });
});
