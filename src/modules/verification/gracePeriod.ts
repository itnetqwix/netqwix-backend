import userModel from "../../model/user.schema";
import { VERIFICATION_CONFIG } from "../../config/verification";
import {
  getTrainerVerification,
  hasTrainerFullAccess,
  isTrainer,
} from "./onboardingHelpers";
import { logVerificationAudit } from "./verificationAudit";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when trainer is inside the legacy grace window (full app access). */
export function isInGracePeriod(u: any): boolean {
  if (!isTrainer(u)) return false;
  const tv = getTrainerVerification(u);
  const grace = tv.grace_deadline ? new Date(tv.grace_deadline) : null;
  return Boolean(grace && Date.now() < grace.getTime());
}

export function graceDaysRemaining(u: any): number {
  const tv = getTrainerVerification(u);
  const grace = tv.grace_deadline ? new Date(tv.grace_deadline) : null;
  if (!grace) return 0;
  const ms = grace.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / MS_PER_DAY);
}

/**
 * Legacy trainers get a grace window before forced verification.
 * Brand-new trainer signups (pending, created recently) must verify immediately.
 */
export async function ensureTrainerGracePeriod(userId: string): Promise<void> {
  const u = await userModel.findById(userId);
  if (!u || !isTrainer(u)) return;
  if (hasTrainerFullAccess(u)) return;

  const tv = getTrainerVerification(u);
  if (tv.grace_deadline) return;
  if (tv.onboarding_step === "completed") return;

  const createdAt = u.createdAt ? new Date(u.createdAt).getTime() : 0;
  const ageHours = createdAt ? (Date.now() - createdAt) / (1000 * 60 * 60) : 9999;

  const isBrandNewTrainerSignup =
    u.status === "pending" &&
    ageHours < 48 &&
    !tv.submitted_for_review_at &&
    (tv.onboarding_step === "account_created" || !tv.onboarding_step);

  if (isBrandNewTrainerSignup) return;

  const graceDeadline = new Date(
    Date.now() + VERIFICATION_CONFIG.graceDays * MS_PER_DAY
  );

  u.trainer_verification = u.trainer_verification || {};
  u.trainer_verification.grace_deadline = graceDeadline;
  if (!u.trainer_verification.onboarding_step) {
    u.trainer_verification.onboarding_step = "account_created";
  }
  if (!u.trainer_verification.version) {
    u.trainer_verification.version = 1;
  }
  u.markModified("trainer_verification");
  await u.save();
  await logVerificationAudit(userId, "grace_period_assigned", {
    grace_deadline: graceDeadline,
    grace_days: VERIFICATION_CONFIG.graceDays,
  });
}
