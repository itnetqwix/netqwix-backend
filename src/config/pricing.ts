/** Default pricing configuration for US + CA (admin-overridable via pricing_config collection). */

export type PricingRegion = "US" | "CA";
export type PricingProductType =
  | "session_booking"
  | "instant_lesson"
  | "session_extension"
  | "storage_subscription"
  | "wallet_topup";

export type PaymentMethodFee = { bps: number; fixedMinor: number };

export type RegionPricingConfig = {
  currency: "USD" | "CAD";
  traineePlatformFeeMinor: number;
  trainerPlatformFeeMinor: number;
  defaultCommissionRate: number;
  minCommissionRateFloor: number;
  passProcessingFeeToTrainee: boolean;
  paymentMethodFees: Record<string, PaymentMethodFee>;
  storagePlans: Record<
    string,
    { monthlyMinor: number; yearlyMinor: number; quotaBytes: number; label: string }
  >;
  stripeTaxEnabled: boolean;
  cogsMinor: {
    liveSessionPerHour: number;
    groupClassPerSeatHour: number;
    pdfUpload: number;
    clipPerGbMonth: number;
  };
};

export type ProductFeeOverride = {
  traineePlatformFeeMinor: number;
  trainerPlatformFeeMinor: number;
};

export type PricingConfigDoc = {
  version: number;
  effectiveAt: Date;
  quoteToleranceMinor: number;
  regions: Record<PricingRegion, RegionPricingConfig>;
  productFees: Record<PricingProductType, ProductFeeOverride>;
};

const US_PM_FEES: Record<string, PaymentMethodFee> = {
  card_domestic_us: { bps: 290, fixedMinor: 30 },
  card_international_us: { bps: 440, fixedMinor: 30 },
  apple_pay_us: { bps: 290, fixedMinor: 30 },
  google_pay_us: { bps: 290, fixedMinor: 30 },
  link_us: { bps: 290, fixedMinor: 30 },
  amazon_pay_us: { bps: 290, fixedMinor: 30 },
  cashapp_us: { bps: 290, fixedMinor: 30 },
  wallet_us: { bps: 0, fixedMinor: 0 },
  wallet_mixed_us: { bps: 290, fixedMinor: 30 },
};

const CA_PM_FEES: Record<string, PaymentMethodFee> = {
  card_domestic_ca: { bps: 290, fixedMinor: 30 },
  card_international_ca: { bps: 370, fixedMinor: 30 },
  apple_pay_ca: { bps: 290, fixedMinor: 30 },
  google_pay_ca: { bps: 290, fixedMinor: 30 },
  link_ca: { bps: 290, fixedMinor: 30 },
  interac_ca: { bps: 290, fixedMinor: 30 },
  wallet_ca: { bps: 0, fixedMinor: 0 },
  wallet_mixed_ca: { bps: 290, fixedMinor: 30 },
};

/** Combined sales tax rate estimates when Stripe Tax is off (verify with CPA). */
export const US_STATE_TAX_RATES: Record<string, number> = {
  TX: 0.0825,
  CA: 0.095,
  NY: 0.08875,
  FL: 0.07,
  WA: 0.1025,
  OR: 0,
  DE: 0,
  MT: 0,
  NH: 0,
  AK: 0,
  DEFAULT: 0.08,
};

export const CA_PROVINCE_TAX_RATES: Record<string, number> = {
  ON: 0.13,
  AB: 0.05,
  BC: 0.12,
  QC: 0.14975,
  MB: 0.12,
  SK: 0.11,
  NS: 0.15,
  NB: 0.15,
  NL: 0.15,
  PE: 0.15,
  NT: 0.05,
  NU: 0.05,
  YT: 0.05,
  DEFAULT: 0.13,
};

export const DEFAULT_PRICING_CONFIG: PricingConfigDoc = {
  version: 1,
  effectiveAt: new Date(),
  quoteToleranceMinor: 5,
  regions: {
    US: {
      currency: "USD",
      traineePlatformFeeMinor: 50,
      trainerPlatformFeeMinor: 50,
      defaultCommissionRate: 0.15,
      minCommissionRateFloor: 0.05,
      passProcessingFeeToTrainee: true,
      paymentMethodFees: US_PM_FEES,
      stripeTaxEnabled: process.env.STRIPE_TAX_ENABLED === "true",
      cogsMinor: {
        liveSessionPerHour: 40,
        groupClassPerSeatHour: 30,
        pdfUpload: 5,
        clipPerGbMonth: 2,
      },
      storagePlans: {
        free: { label: "Free", quotaBytes: 2 * 1024 * 1024 * 1024, monthlyMinor: 0, yearlyMinor: 0 },
        plus_5gb: { label: "Plus", quotaBytes: 5 * 1024 * 1024 * 1024, monthlyMinor: 300, yearlyMinor: 3240 },
        pro_10gb: { label: "Pro", quotaBytes: 10 * 1024 * 1024 * 1024, monthlyMinor: 500, yearlyMinor: 5400 },
        max_25gb: { label: "Max", quotaBytes: 25 * 1024 * 1024 * 1024, monthlyMinor: 1000, yearlyMinor: 10800 },
      },
    },
    CA: {
      currency: "CAD",
      traineePlatformFeeMinor: 50,
      trainerPlatformFeeMinor: 50,
      defaultCommissionRate: 0.15,
      minCommissionRateFloor: 0.05,
      passProcessingFeeToTrainee: true,
      paymentMethodFees: CA_PM_FEES,
      stripeTaxEnabled: process.env.STRIPE_TAX_ENABLED === "true",
      cogsMinor: {
        liveSessionPerHour: 53,
        groupClassPerSeatHour: 40,
        pdfUpload: 7,
        clipPerGbMonth: 3,
      },
      storagePlans: {
        free: { label: "Free", quotaBytes: 2 * 1024 * 1024 * 1024, monthlyMinor: 0, yearlyMinor: 0 },
        plus_5gb: { label: "Plus", quotaBytes: 5 * 1024 * 1024 * 1024, monthlyMinor: 400, yearlyMinor: 4320 },
        pro_10gb: { label: "Pro", quotaBytes: 10 * 1024 * 1024 * 1024, monthlyMinor: 650, yearlyMinor: 7020 },
        max_25gb: { label: "Max", quotaBytes: 25 * 1024 * 1024 * 1024, monthlyMinor: 1300, yearlyMinor: 14040 },
      },
    },
  },
  productFees: {
    session_booking: { traineePlatformFeeMinor: 50, trainerPlatformFeeMinor: 50 },
    instant_lesson: { traineePlatformFeeMinor: 50, trainerPlatformFeeMinor: 50 },
    session_extension: { traineePlatformFeeMinor: 50, trainerPlatformFeeMinor: 50 },
    storage_subscription: { traineePlatformFeeMinor: 0, trainerPlatformFeeMinor: 0 },
    wallet_topup: { traineePlatformFeeMinor: 0, trainerPlatformFeeMinor: 0 },
  },
};

export const PRICING_QUOTE_ENABLED = process.env.PRICING_QUOTE_ENABLED !== "false";

export function resolveRegionFromCountry(country?: string): PricingRegion {
  const c = String(country || "US").toUpperCase();
  if (c === "CA" || c === "CAN") return "CA";
  return "US";
}

export function defaultPaymentMethodHint(region: PricingRegion): string {
  return region === "CA" ? "card_domestic_ca" : "card_domestic_us";
}
