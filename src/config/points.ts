import { AccountType } from "../modules/auth/authEnum";
import type { ReferralRole } from "./referral";

export const POINTS_CONFIG = {
  enabled: process.env.POINTS_ENABLED !== "false",
  /** 100 points = $5 wallet credit */
  redemptionBlockPoints: Number(process.env.POINTS_REDEEM_BLOCK || 100),
  pointsPerDollar: Number(process.env.POINTS_PER_DOLLAR || 20),
  minRedeemPoints: Number(process.env.POINTS_MIN_REDEEM || 100),
  maxPointsPerAction: 5,
  currency: process.env.REFERRAL_CURRENCY || "USD",
} as const;

export type PointsActionKey =
  | "referral_signup_referrer"
  | "referral_signup_referee"
  | "referral_first_booking_referrer"
  | "lesson_completed_trainer"
  | "lesson_completed_trainee"
  | "booking_completed_trainee"
  | "game_plan_pdf_created"
  | "review_submitted"
  | "points_redeem";

export type EarnRule = {
  actionKey: PointsActionKey;
  label: string;
  description: string;
  points: 1 | 3 | 5;
  roles: (typeof AccountType.TRAINER | typeof AccountType.TRAINEE)[];
  weeklyCap?: number;
  dailyCap?: number;
};

export const EARN_RULES: EarnRule[] = [
  {
    actionKey: "lesson_completed_trainer",
    label: "Lesson completed (coach)",
    description: "Earn when you complete a session as coach.",
    points: 3,
    roles: [AccountType.TRAINER],
    weeklyCap: 15,
  },
  {
    actionKey: "lesson_completed_trainee",
    label: "Lesson completed",
    description: "Earn when you complete a session as trainee.",
    points: 3,
    roles: [AccountType.TRAINEE],
    weeklyCap: 15,
  },
  {
    actionKey: "booking_completed_trainee",
    label: "Booking completed",
    description: "Earn when a booked session you attended is completed.",
    points: 1,
    roles: [AccountType.TRAINEE],
    weeklyCap: 7,
  },
  {
    actionKey: "game_plan_pdf_created",
    label: "Game plan saved",
    description: "Earn when you save a session game plan.",
    points: 5,
    roles: [AccountType.TRAINER],
    dailyCap: 5,
  },
  {
    actionKey: "review_submitted",
    label: "Review submitted",
    description: "Earn when you rate a completed session.",
    points: 3,
    roles: [AccountType.TRAINEE],
    weeklyCap: 15,
  },
];

function matrixKey(referrer: ReferralRole, referee: ReferralRole): string {
  return `${referrer}:${referee}`;
}

/** Referral signup / first-booking rewards in points (max 5 per event). */
const REFERRAL_SIGNUP_REFERRER_PTS: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: 5,
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: 5,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: 5,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: 5,
};

const REFERRAL_SIGNUP_REFEREE_PTS: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: 3,
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: 0,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: 3,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: 3,
};

const REFERRAL_FIRST_BOOKING_REFERRER_PTS: Record<string, number> = {
  [matrixKey(AccountType.TRAINER, AccountType.TRAINEE)]: 5,
  [matrixKey(AccountType.TRAINER, AccountType.TRAINER)]: 0,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINEE)]: 5,
  [matrixKey(AccountType.TRAINEE, AccountType.TRAINER)]: 0,
};

export function referralMatrixPoints(
  trigger: "signup" | "first_booking",
  beneficiary: "referrer" | "referee",
  referrerType: ReferralRole,
  refereeType: ReferralRole
): number {
  const key = matrixKey(referrerType, refereeType);
  const cap = POINTS_CONFIG.maxPointsPerAction;
  let raw = 0;
  if (trigger === "signup") {
    raw =
      beneficiary === "referrer"
        ? REFERRAL_SIGNUP_REFERRER_PTS[key] ?? 0
        : REFERRAL_SIGNUP_REFEREE_PTS[key] ?? 0;
  } else if (trigger === "first_booking" && beneficiary === "referrer") {
    raw = REFERRAL_FIRST_BOOKING_REFERRER_PTS[key] ?? 0;
  }
  return Math.min(Math.max(0, raw), cap);
}

export function pointsToWalletMinor(points: number): number {
  const perDollar = POINTS_CONFIG.pointsPerDollar;
  const dollars = points / perDollar;
  return Math.round(dollars * 100);
}

export function redeemBlocksAvailable(balance: number): number {
  const block = POINTS_CONFIG.redemptionBlockPoints;
  if (block <= 0) return 0;
  return Math.floor(balance / block);
}

export function getEarnRule(actionKey: PointsActionKey): EarnRule | undefined {
  return EARN_RULES.find((r) => r.actionKey === actionKey);
}

export function formatRewardPreviewPoints(
  referrerType: ReferralRole,
  targetType: ReferralRole
): {
  referrerSignupPoints: number;
  refereeSignupPoints: number;
  referrerFirstBookingPoints: number;
} {
  return {
    referrerSignupPoints: referralMatrixPoints("signup", "referrer", referrerType, targetType),
    refereeSignupPoints: referralMatrixPoints("signup", "referee", referrerType, targetType),
    referrerFirstBookingPoints: referralMatrixPoints(
      "first_booking",
      "referrer",
      referrerType,
      targetType
    ),
  };
}
