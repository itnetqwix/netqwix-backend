/**
 * P5-3: Card PI webhook path must not double-create escrow when PI id already exists.
 */

const mockFindOneLean = jest.fn();
jest.mock("../../../model/escrow_holds.schema", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ lean: mockFindOneLean })),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../ledgerService", () => ({
  ledgerService: { post: jest.fn().mockResolvedValue({ entryIds: [], idempotent: false }) },
}));

jest.mock("../walletAccountService", () => ({
  walletAccountService: {
    getOrCreatePlatformAccount: jest.fn().mockResolvedValue({ _id: "plat" }),
    getOrCreateUserWallet: jest.fn().mockResolvedValue({ _id: "wal" }),
  },
}));

jest.mock("../../../config/wallet", () => ({
  WALLET_CONFIG: { escrowEnabled: true },
}));

import escrow_holds from "../../../model/escrow_holds.schema";
import { escrowService } from "../escrowService";

describe("escrow single writer by payment_intent_id", () => {
  const svc = escrowService;

  it("returns existing hold when stripe_payment_intent_id matches", async () => {
    const existing = { _id: "hold_pi", stripe_payment_intent_id: "pi_abc" };
    mockFindOneLean.mockResolvedValue(existing);

    const result = await svc.createCardEscrowRecord({
      sessionId: "s1",
      traineeId: "u1",
      trainerId: "u2",
      grossMinor: 5000,
      platformFeeMinor: 0,
      fundingSource: "card",
      stripePaymentIntentId: "pi_abc",
      kind: "booking",
      idempotencyKey: "book:escrow:s1",
    });

    expect(result).toBe(existing);
    expect(escrow_holds.create).not.toHaveBeenCalled();
  });
});
