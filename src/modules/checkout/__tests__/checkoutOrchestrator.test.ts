import { checkoutOrchestrator } from "../checkoutOrchestrator";

jest.mock("../../wallet/escrowService", () => ({
  escrowService: {
    createCardEscrowRecord: jest.fn().mockResolvedValue({ _id: "hold1" }),
  },
}));

jest.mock("../../../model/user.schema", () => ({
  __esModule: true,
  default: { updateOne: jest.fn().mockResolvedValue({}) },
}));

describe("CheckoutOrchestrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips escrow when payment_intent_id is set (webhook is single writer)", async () => {
    const { escrowService } = require("../../wallet/escrowService");
    await checkoutOrchestrator.createEscrowIfNeeded({
      sessionId: "sess1",
      traineeId: "t1",
      trainerId: "tr1",
      finalPrice: 50,
      paymentMethod: "card",
      paymentIntentId: "pi_123",
    });
    expect(escrowService.createCardEscrowRecord).not.toHaveBeenCalled();
  });

  it("creates escrow for legacy card path without PI", async () => {
    const { escrowService } = require("../../wallet/escrowService");
    await checkoutOrchestrator.createEscrowIfNeeded({
      sessionId: "sess2",
      traineeId: "t1",
      trainerId: "tr1",
      finalPrice: 25,
      paymentMethod: "card",
    });
    expect(escrowService.createCardEscrowRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess2",
        stripePaymentIntentId: undefined,
        idempotencyKey: "book:escrow:sess2",
      })
    );
  });
});
