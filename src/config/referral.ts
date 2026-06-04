import { AccountType } from "../modules/auth/authEnum";

/** Role keys used in reward matrices (Trainer | Trainee). */
export type ReferralRole = AccountType.TRAINER | AccountType.TRAINEE;

export type ReferralRewardTrigger = "signup" | "first_booking";

export type ReferralBeneficiary = "referrer" | "referee";

/**
 * Wallet credit amounts in minor units (USD cents by default).
 * Override via env, e.g. REFERRAL_SIGNUP_REFERRER_TRAINER_TRAINEE_MINOR=1000
 */
function envMinor(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function matrixKey(referrer: ReferralRole, referee: ReferralRole): string {
  return `${referrer}:${referee}`;
}

const SIGNUP_REFERRER: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_SIGNUP_REFERRER_TRAINER_TRAINEE_MINOR",
    1000
  ),
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: envMinor(
    "REFERRAL_SIGNUP_REFERRER_TRAINER_TRAINER_MINOR",
    2000
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_SIGNUP_REFERRER_TRAINEE_TRAINEE_MINOR",
    500
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: envMinor(
    "REFERRAL_SIGNUP_REFERRER_TRAINEE_TRAINER_MINOR",
    1500
  ),
};

const SIGNUP_REFEREE: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_SIGNUP_REFEREE_TRAINER_TRAINEE_MINOR",
    1000
  ),
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: envMinor(
    "REFERRAL_SIGNUP_REFEREE_TRAINER_TRAINER_MINOR",
    0
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_SIGNUP_REFEREE_TRAINEE_TRAINEE_MINOR",
    500
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: envMinor(
    "REFERRAL_SIGNUP_REFEREE_TRAINEE_TRAINER_MINOR",
    1000
  ),
};

const FIRST_BOOKING_REFERRER: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_FIRST_BOOKING_REFERRER_TRAINER_TRAINEE_MINOR",
    1500
  ),
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: envMinor(
    "REFERRAL_FIRST_BOOKING_REFERRER_TRAINER_TRAINER_MINOR",
    0
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: envMinor(
    "REFERRAL_FIRST_BOOKING_REFERRER_TRAINEE_TRAINEE_MINOR",
    1000
  ),
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: envMinor(
    "REFERRAL_FIRST_BOOKING_REFERRER_TRAINEE_TRAINER_MINOR",
    0
  ),
};

const FIRST_LESSON_DISCOUNT_TYPE =
  process.env.REFERRAL_FIRST_LESSON_DISCOUNT_TYPE === "percentage"
    ? "percentage"
    : "fixed_amount";

export const REFERRAL_CONFIG = {
  enabled: process.env.REFERRAL_ENABLED !== "false",
  /** Disabled — referral benefits are points-only (redeem in Wallet). */
  firstLessonDiscount: {
    enabled: false,
    discountType: FIRST_LESSON_DISCOUNT_TYPE as "percentage" | "fixed_amount",
    /** Dollars if fixed_amount; percent 0–100 if percentage. */
    discountValue:
      FIRST_LESSON_DISCOUNT_TYPE === "percentage"
        ? envNumber("REFERRAL_FIRST_LESSON_DISCOUNT_PERCENT", 25)
        : envNumber("REFERRAL_FIRST_LESSON_DISCOUNT_DOLLARS", 15),
    maxDiscountDollars: envNumber("REFERRAL_FIRST_LESSON_MAX_DISCOUNT_DOLLARS", 25),
    minOrderDollars: envNumber("REFERRAL_FIRST_LESSON_MIN_ORDER_DOLLARS", 0),
  },
  /** Public share link base (web signup). */
  webSignupPath: "/signup",
  /** App deep link path segment. */
  appSignupPath: "signup",
  maxInvitesPerRequest: 10,
  codePrefix: "NQ",
  codeLength: 6,
  currency: process.env.REFERRAL_CURRENCY || "USD",
  signupReferrerMinor: SIGNUP_REFERRER,
  signupRefereeMinor: SIGNUP_REFEREE,
  firstBookingReferrerMinor: FIRST_BOOKING_REFERRER,
} as const;

export function referralMatrixAmount(
  trigger: ReferralRewardTrigger,
  beneficiary: ReferralBeneficiary,
  referrerType: ReferralRole,
  refereeType: ReferralRole
): number {
  const key = matrixKey(referrerType, refereeType);
  if (trigger === "signup") {
    return beneficiary === "referrer"
      ? REFERRAL_CONFIG.signupReferrerMinor[key] ?? 0
      : REFERRAL_CONFIG.signupRefereeMinor[key] ?? 0;
  }
  if (trigger === "first_booking" && beneficiary === "referrer") {
    return REFERRAL_CONFIG.firstBookingReferrerMinor[key] ?? 0;
  }
  return 0;
}

export function formatRewardPreview(
  referrerType: ReferralRole,
  targetType: ReferralRole
): {
  referrerSignupMinor: number;
  refereeSignupMinor: number;
  referrerFirstBookingMinor: number;
  refereeFirstLessonCheckoutDiscountDollars: number;
} {
  const firstLesson =
    targetType === AccountType.TRAINEE && REFERRAL_CONFIG.firstLessonDiscount.enabled
      ? estimateFirstLessonCheckoutDiscount(100)
      : 0;
  return {
    referrerSignupMinor: referralMatrixAmount("signup", "referrer", referrerType, targetType),
    refereeSignupMinor: referralMatrixAmount("signup", "referee", referrerType, targetType),
    referrerFirstBookingMinor: referralMatrixAmount(
      "first_booking",
      "referrer",
      referrerType,
      targetType
    ),
    refereeFirstLessonCheckoutDiscountDollars: firstLesson,
  };
}

/** Estimate checkout discount for a given lesson list price (USD). */
export function estimateFirstLessonCheckoutDiscount(originalPriceDollars: number): number {
  const cfg = REFERRAL_CONFIG.firstLessonDiscount;
  if (!cfg.enabled || originalPriceDollars < cfg.minOrderDollars) return 0;
  let raw = 0;
  if (cfg.discountType === "percentage") {
    raw = originalPriceDollars * (cfg.discountValue / 100);
  } else {
    raw = cfg.discountValue;
  }
  if (cfg.maxDiscountDollars > 0) raw = Math.min(raw, cfg.maxDiscountDollars);
  return Number(Math.min(raw, originalPriceDollars).toFixed(2));
}
