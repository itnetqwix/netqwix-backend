/**
 * Integration-style test for TraineeService.bookSessionCore (mocked Mongoose + deps).
 */
import mongoose from "mongoose";
import { DateTime } from "luxon";
import { BOOKED_SESSIONS_STATUS } from "../../../config/constance";

const mockSave = jest.fn();
const mockBookedSessionCtor = jest.fn();

jest.mock("../../../model/booked_sessions.schema", () => {
  mockBookedSessionCtor.mockImplementation(function BookedSession(this: any, data: any) {
    Object.assign(this, data);
    this.save = mockSave;
    return this;
  });
  return { __esModule: true, default: mockBookedSessionCtor };
});

jest.mock("../../../model/user.schema", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("../../../Utils/bookingConflict", () => ({
  checkBothPartiesBookingConflict: jest.fn(),
}));

jest.mock("../../../services/distributedLock", () => ({
  withDistributedLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock("../../promo-code/promoCodeService", () => ({
  PromoCodeService: jest.fn().mockImplementation(() => ({
    validatePromoCode: jest.fn(),
    applyPromoCode: jest.fn(),
  })),
}));

jest.mock("../../../Utils/sendEmail", () => ({
  SendEmail: { sendRawEmail: jest.fn() },
}));

jest.mock("../../../services/sms-service", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    sendSMS: jest.fn(),
  })),
}));

jest.mock("../../socket/socket.service", () => ({
  emitBookingCreated: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../helpers/userActivity", () => ({
  recordUserActivityMany: jest.fn(),
  UserActivityEvent: { BOOKING_CREATED: "BOOKING_CREATED" },
}));

jest.mock("../../../services/cacheService", () => ({
  invalidateUserSessionsCache: jest.fn(),
}));

jest.mock("../../../config/wallet", () => ({
  WALLET_CONFIG: { escrowEnabled: false },
}));

jest.mock("../../wallet/walletPaymentService", () => ({
  walletPaymentService: {
    payFromWallet: jest.fn().mockResolvedValue(undefined),
    refundWalletPaymentForSession: jest.fn(),
  },
}));

import user from "../../../model/user.schema";
import { checkBothPartiesBookingConflict } from "../../../Utils/bookingConflict";
import { TraineeService } from "../traineeService";
import { walletPaymentService } from "../../wallet/walletPaymentService";

const mockUserFindById = user.findById as jest.Mock;
const mockConflict = checkBothPartiesBookingConflict as jest.Mock;

function muteNotifications() {
  return {
    fullname: "Test User",
    email: "test@example.com",
    mobile_no: "+10000000000",
    notifications: { transactional: { email: false, sms: false } },
    extraInfo: {
      hourly_rate: 60,
      availabilityInfo: { timeZone: "America/New_York" },
    },
  };
}

describe("bookSessionCore", () => {
  const service = new TraineeService();
  const trainerId = new mongoose.Types.ObjectId().toString();
  const traineeId = new mongoose.Types.ObjectId().toString();
  const bookingId = new mongoose.Types.ObjectId();

  const validPayload = () => ({
    trainer_id: trainerId,
    status: BOOKED_SESSIONS_STATUS.BOOKED,
    booked_date: DateTime.now().plus({ days: 14 }).toISODate()!,
    session_start_time: "10:00",
    session_end_time: "11:00",
    charging_price: 60,
    time_zone: "America/New_York",
    payment_method: "wallet",
    pin_session_token: "123456",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConflict.mockResolvedValue(null);
    mockSave.mockImplementation(async function (this: any) {
      return { ...this, _id: bookingId };
    });
    mockUserFindById.mockImplementation((arg: { _id?: string } | string) => {
      const key =
        typeof arg === "object" && arg?._id != null ? String(arg._id) : String(arg);
      if (key === trainerId && typeof arg === "string") {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ extraInfo: { hourly_rate: 60 } }),
          }),
        };
      }
      if (key === trainerId || key === traineeId) {
        return Promise.resolve(muteNotifications());
      }
      return Promise.resolve(null);
    });
  });

  it("creates a scheduled booking when validation, conflict, and wallet pass", async () => {
    const result = await (service as any).bookSessionCore(
      validPayload(),
      traineeId
    );
    expect(result.code).toBe(200);
    expect(mockConflict).toHaveBeenCalled();
    expect(walletPaymentService.payFromWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        traineeId,
        trainerId,
        kind: "booking",
      })
    );
    expect(mockSave).toHaveBeenCalled();
    expect(mockBookedSessionCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        trainee_id: traineeId,
        trainer_id: trainerId,
      })
    );
  });

  it("returns 409 when trainer has a conflicting booking", async () => {
    mockConflict.mockResolvedValue(
      "This trainer already has a booking during this time slot."
    );
    const result = await (service as any).bookSessionCore(
      validPayload(),
      traineeId
    );
    expect(result.code).toBe(409);
    expect(mockSave).not.toHaveBeenCalled();
    expect(walletPaymentService.payFromWallet).not.toHaveBeenCalled();
  });

  it("returns 400 when promo code is invalid", async () => {
    const { PromoCodeService } = require("../../promo-code/promoCodeService");
    PromoCodeService.mockImplementation(() => ({
      validatePromoCode: jest.fn().mockResolvedValue({
        valid: false,
        reason: "Expired code",
      }),
      applyPromoCode: jest.fn(),
    }));
    const result = await (service as any).bookSessionCore(
      { ...validPayload(), coupon_code: "BAD" },
      traineeId
    );
    expect(result.code).toBe(400);
    expect(String(result.error)).toMatch(/expired/i);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns 400 when price does not match trainer hourly rate", async () => {
    const result = await (service as any).bookSessionCore(
      { ...validPayload(), charging_price: 10 },
      traineeId
    );
    expect(result.code).toBe(400);
    expect(String(result.error)).toMatch(/price does not match/i);
  });

  it("rolls back wallet payment when save fails", async () => {
    mockSave.mockRejectedValueOnce(new Error("duplicate key"));
    const result = await (service as any).bookSessionCore(
      validPayload(),
      traineeId
    );
    expect(result.code).toBe(500);
    expect(walletPaymentService.refundWalletPaymentForSession).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "booking_save_failed" })
    );
  });
});
