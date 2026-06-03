import booked_session from "../../../model/booked_sessions.schema";
import escrow_holds from "../../../model/escrow_holds.schema";
import { REFUND_STATUS } from "../../../config/paymentStatus";

jest.mock("../../../model/booked_sessions.schema", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    find: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

jest.mock("../../../model/escrow_holds.schema", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../../../config/wallet", () => ({
  WALLET_CONFIG: { escrowEnabled: true },
}));

jest.mock("../releaseService", () => ({
  releaseService: {
    refundHold: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../walletTimelineService", () => ({
  walletTimelineService: { append: jest.fn() },
}));

import {
  processPendingInstantRefunds,
  refundSessionEscrow,
} from "../instantLessonRefundService";

const mockFindById = booked_session.findById as jest.Mock;
const mockUpdate = booked_session.findByIdAndUpdate as jest.Mock;
const mockHoldFind = escrow_holds.findOne as jest.Mock;

function mockNoHold() {
  mockHoldFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
    lean: jest.fn().mockResolvedValue(null),
  });
}

describe("refundSessionEscrow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockNoHold();
  });

  it("is idempotent when refund already completed", async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "s1",
        refund_status: REFUND_STATUS.COMPLETED,
      }),
    });
    const r = await refundSessionEscrow("s1", "declined");
    expect(r.refunded).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("completes free bookings without hold or PI", async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "s1",
        is_instant: true,
        amount: "0",
        trainee_id: "t1",
        trainer_id: "c1",
      }),
    });
    const r = await refundSessionEscrow("s1", "accept_expired");
    expect(r.refunded).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        $set: expect.objectContaining({
          refund_status: REFUND_STATUS.COMPLETED,
        }),
      })
    );
  });

  it("fails when paid booking has no hold or PI", async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "s1",
        amount: "25",
        charging_price: 25,
        trainee_id: "t1",
      }),
    });
    const r = await refundSessionEscrow("s1", "declined");
    expect(r.refunded).toBe(false);
    expect(r.error).toMatch(/no escrow/i);
  });

  it("processPendingInstantRefunds retries cancelled sessions", async () => {
    const mockFind = booked_session.find as jest.Mock;
    mockFind.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: "s2", refund_reason: "declined", refund_status: "processing" },
        ]),
      }),
    });
    mockFindById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "s2",
        amount: "0",
        trainee_id: "t1",
      }),
    });
    const count = await processPendingInstantRefunds();
    expect(count).toBe(1);
  });
});
