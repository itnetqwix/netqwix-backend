import PromoCode from "../../../model/promo_code.schema";
import { PromoCodeService } from "../promoCodeService";

jest.mock("../../../model/promo_code.schema");

describe("revertPromoUsage", () => {
  const service = new PromoCodeService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pulls used_by row and decrements usage_count", async () => {
    const bookingId = "507f1f77bcf86cd799439011";
    const userId = "507f1f77bcf86cd799439012";
    (PromoCode.findOne as jest.Mock).mockResolvedValue({
      code: "SAVE10",
      usage_count: 1,
      used_by: [{ user_id: userId, booking_id: bookingId }],
    });
    (PromoCode.updateOne as jest.Mock).mockResolvedValue({});

    const res = await service.revertPromoUsage("save10", userId, bookingId);
    expect(res.reverted).toBe(true);
    expect(PromoCode.updateOne).toHaveBeenCalledWith(
      { code: "SAVE10" },
      expect.objectContaining({
        $pull: { used_by: { booking_id: bookingId, user_id: userId } },
        $inc: { usage_count: -1 },
      })
    );
  });

  it("no-op when booking not in used_by", async () => {
    (PromoCode.findOne as jest.Mock).mockResolvedValue({
      code: "SAVE10",
      usage_count: 1,
      used_by: [],
    });
    const res = await service.revertPromoUsage("SAVE10", "u1", "b1");
    expect(res.reverted).toBe(false);
    expect(PromoCode.updateOne).not.toHaveBeenCalled();
  });
});
