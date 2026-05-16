import { AccountType } from "../auth/authEnum";
import { VERIFICATION_CONFIG, type OnboardingStep } from "../../config/verification";
import { maskEmail, maskPhone } from "./contactVerificationSync";
import { graceDaysRemaining, isInGracePeriod } from "./gracePeriod";

export type ContactSubstep = "email" | "phone" | "complete";

export type OnboardingStatusPayload = {
  required: boolean;
  step: OnboardingStep | null;
  status: string;
  rejection_reason?: string;
  email_verified: boolean;
  phone_verified: boolean;
  email_masked?: string | null;
  phone_masked?: string | null;
  contact_substep?: ContactSubstep;
  submitted_for_review_at?: Date;
  review_escalated_at?: Date;
  grace_deadline?: Date;
  in_grace_period?: boolean;
  grace_days_remaining?: number;
  next_route?: string;
};

const STEP_ROUTES: Record<string, string> = {
  account_created: "/onboarding/contact",
  contact_verified: "/onboarding/profile",
  profile_face_complete: "/onboarding/profile",
  under_review: "/onboarding/pending",
  completed: "/dashboard",
};

export function getTrainerVerification(u: any) {
  return u?.trainer_verification || {};
}

export function isTrainer(u: any): boolean {
  return String(u?.account_type) === AccountType.TRAINER;
}

/** Trainer has full app access. */
export function hasTrainerFullAccess(u: any): boolean {
  if (!isTrainer(u)) return true;
  const tv = getTrainerVerification(u);
  const step = tv.onboarding_step || "account_created";
  if (step === "completed" && u.status === "approved") return true;
  // Grandfathered approved trainers without verification block
  if (u.status === "approved" && step === "account_created" && !tv.submitted_for_review_at) {
    return true;
  }
  return false;
}

export function isOnboardingRequired(u: any): boolean {
  if (!isTrainer(u)) return false;
  if (hasTrainerFullAccess(u)) return false;

  const tv = getTrainerVerification(u);
  const grace = tv.grace_deadline ? new Date(tv.grace_deadline) : null;
  if (grace && Date.now() < grace.getTime()) return false;

  return true;
}

export function buildOnboardingStatus(u: any): OnboardingStatusPayload {
  if (!isTrainer(u)) {
    return {
      required: false,
      step: null,
      status: u?.status || "approved",
      email_verified: true,
      phone_verified: true,
    };
  }

  const tv = getTrainerVerification(u);
  const step = (tv.onboarding_step || "account_created") as OnboardingStep;
  const required = isOnboardingRequired(u);
  const emailVerified = Boolean(tv.email_verified_at);
  const phoneVerified = Boolean(tv.phone_verified_at);
  const contactSubstep: ContactSubstep = !emailVerified
    ? "email"
    : !phoneVerified
      ? "phone"
      : "complete";

  return {
    required,
    step: required ? step : "completed",
    status: u.status || "pending",
    rejection_reason: tv.rejection_reason,
    email_verified: emailVerified,
    phone_verified: phoneVerified,
    email_masked: maskEmail(u.email),
    phone_masked: maskPhone(u.mobile_no),
    contact_substep: contactSubstep,
    submitted_for_review_at: tv.submitted_for_review_at,
    review_escalated_at: tv.review_escalated_at,
    grace_deadline: tv.grace_deadline,
    in_grace_period: isInGracePeriod(u),
    grace_days_remaining: isInGracePeriod(u) ? graceDaysRemaining(u) : 0,
    next_route: required ? STEP_ROUTES[step] || "/onboarding/contact" : "/dashboard",
  };
}

export function initTrainerVerificationOnSignup(isGoogle = false) {
  return {
    onboarding_step: "account_created",
    email_verified_at: isGoogle ? new Date() : undefined,
    version: 1,
  };
}

export const ONBOARDING_ALLOWED_PATH_PREFIXES = [
  "/verification",
  "/auth/",
  "/user/me",
  "/master/",
  "/common/",
];

export function isOnboardingWhitelistedPath(path: string, originalUrl?: string): boolean {
  const p = (path || "").split("?")[0];
  const full = (originalUrl || p).split("?")[0];
  return ONBOARDING_ALLOWED_PATH_PREFIXES.some(
    (prefix) => p.startsWith(prefix) || full.includes(prefix)
  );
}
