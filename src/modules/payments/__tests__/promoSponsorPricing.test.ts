import { computePromoPayoutSplit } from "../promoSponsorPricing";
import { PROMO_SPONSOR } from "../../../config/promo";

describe("computePromoPayoutSplit", () => {
  const rate = 0.2;
  const trainerFee = 50;

  it("platform promo: trainer net based on full list price", () => {
    const split = computePromoPayoutSplit({
      sessionSubtotalCents: 10_000,
      promoDiscountCents: 2_000,
      promoSponsorType: PROMO_SPONSOR.PLATFORM,
      commissionRate: rate,
      trainerPlatformFeeCents: trainerFee,
    });
    expect(split.discountedSubtotalCents).toBe(8_000);
    expect(split.commissionBaseCents).toBe(10_000);
    expect(split.platformFeePercentCents).toBe(2_000);
    expect(split.trainerNetCents).toBe(7_950);
    expect(split.platformPromoSubsidyCents).toBe(2_000);
  });

  it("trainer promo: discount reduces trainer net", () => {
    const split = computePromoPayoutSplit({
      sessionSubtotalCents: 10_000,
      promoDiscountCents: 2_000,
      promoSponsorType: PROMO_SPONSOR.TRAINER,
      commissionRate: rate,
      trainerPlatformFeeCents: trainerFee,
    });
    expect(split.discountedSubtotalCents).toBe(8_000);
    expect(split.commissionBaseCents).toBe(8_000);
    expect(split.platformFeePercentCents).toBe(1_600);
    expect(split.trainerNetCents).toBe(6_350);
    expect(split.platformPromoSubsidyCents).toBe(0);
  });
});
