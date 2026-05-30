import { buildQuote } from "../pricingService";

jest.mock("../../../model/pricing_config.schema", () => ({
  __esModule: true,
  default: {
    countDocuments: jest.fn().mockResolvedValue(1),
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock("../../../model/default_admin_setting.schema", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ commission: 15 }),
    }),
  },
}));

jest.mock("../../../model/user.schema", () => ({
  __esModule: true,
  default: { findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }) },
}));

describe("pricingService.buildQuote", () => {
  it("includes trainee and trainer platform fees on a $100 US session", async () => {
    const quote = await buildQuote({
      region: "US",
      productType: "session_booking",
      sessionSubtotalCents: 10000,
      paymentMethodHint: "card_domestic_us",
      billingAddress: { country: "US", state: "TX" },
    });

    expect(quote.traineePlatformFeeCents).toBe(50);
    expect(quote.trainerPlatformFeeCents).toBe(50);
    expect(quote.platformFeePercentCents).toBe(1500);
    expect(quote.trainerNetCents).toBe(8450);
    expect(quote.chargeTotalCents).toBeGreaterThan(10050);
    expect(quote.breakdown.some((r) => r.key === "trainee_platform_fee")).toBe(true);
  });

  it("uses zero processing for wallet hint", async () => {
    const quote = await buildQuote({
      region: "US",
      productType: "session_booking",
      sessionSubtotalCents: 10000,
      paymentMethodHint: "wallet_us",
      billingAddress: { country: "US", state: "TX" },
    });

    expect(quote.processingFeeCents).toBe(0);
    expect(quote.chargeTotalCents).toBeGreaterThan(10050);
  });
});
