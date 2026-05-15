/** NetQwix wallet & escrow feature flags and policy constants. */
export const WALLET_CONFIG = {
  /** Master switch for wallet APIs */
  enabled: process.env.WALLET_ENABLED !== "false",
  /** Escrow hold on booking/extension (platform charge, delayed transfer) */
  escrowEnabled: process.env.WALLET_ESCROW_ENABLED === "true",
  /** Allow paying from wallet balance */
  walletPayEnabled: process.env.WALLET_PAY_ENABLED !== "false",
  defaultCurrency: "USD",
  platformAccountKey: "PLATFORM",
  pinMaxAttempts: 5,
  pinLockMinutes: 15,
  pinSessionTtlMinutes: 15,
  /** Amount in minor units (cents) requiring step-up */
  stepUpThresholdMinor: 10000,
  clearanceHoursFast: 24,
  clearanceHoursStandard: 24,
  maxTopUpMinor: 500_000,
  minTopUpMinor: 500,
  maxWithdrawMinor: 500_000,
  /** Per-region currency enablement (Phase 4) */
  regionCurrency: {
    US: { currency: "USD", topUpEnabled: true, walletPayEnabled: true },
    CA: { currency: "CAD", topUpEnabled: false, walletPayEnabled: false },
    EU: { currency: "EUR", topUpEnabled: false, walletPayEnabled: false },
    GB: { currency: "GBP", topUpEnabled: false, walletPayEnabled: false },
    DEFAULT: { currency: "USD", topUpEnabled: true, walletPayEnabled: true },
  },
} as const;

export type WalletBucket =
  | "available"
  | "pending_topup"
  | "escrow_held"
  | "pending_release"
  | "pending_payout";

export type LedgerReferenceType =
  | "topup"
  | "booking"
  | "extension"
  | "escrow_hold"
  | "escrow_release"
  | "refund"
  | "payout"
  | "adjustment"
  | "migration_opening";

export function resolveCurrencyForRegion(region?: string): string {
  const key = (region || "DEFAULT").toUpperCase();
  const entry =
    WALLET_CONFIG.regionCurrency[key as keyof typeof WALLET_CONFIG.regionCurrency] ??
    WALLET_CONFIG.regionCurrency.DEFAULT;
  return entry.currency;
}

export function isRegionWalletEnabled(
  region?: string,
  kind: "topUp" | "walletPay" = "walletPay"
): boolean {
  const key = (region || "DEFAULT").toUpperCase();
  const entry =
    WALLET_CONFIG.regionCurrency[key as keyof typeof WALLET_CONFIG.regionCurrency] ??
    WALLET_CONFIG.regionCurrency.DEFAULT;
  return kind === "topUp" ? entry.topUpEnabled : entry.walletPayEnabled;
}
