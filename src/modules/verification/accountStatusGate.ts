import { AccountType } from "../auth/authEnum";
import { hasTrainerFullAccess, isTrainer } from "./onboardingHelpers";
import { isInGracePeriod } from "./gracePeriod";

/** Paths reachable while account is pending or rejected (auth + reapply + profile read). */
export const ACCOUNT_STATUS_ALLOWED_PREFIXES = [
  "/verification",
  "/auth/",
  "/user/me",
  "/clips/account/reapply",
  "/common/update-profile-picture",
  "/master/",
];

export function isAccountStatusWhitelistedPath(path: string, originalUrl?: string): boolean {
  const p = (path || "").split("?")[0];
  const full = (originalUrl || p).split("?")[0];
  return ACCOUNT_STATUS_ALLOWED_PREFIXES.some(
    (prefix) => p.startsWith(prefix) || full.includes(prefix)
  );
}

/**
 * Block pending/rejected users from bookings, wallet, chat, clips, etc.
 * Trainers mid-onboarding are handled by `isOnboardingRequired`; this closes
 * the rejected-trainer hole and trainee pending/rejected gaps.
 */
export function isAccountAccessRestricted(u: any): boolean {
  if (!u) return false;
  const status = String(u.status ?? "").toLowerCase();

  if (status === "rejected") return true;

  if (status === "pending") {
    if (String(u.account_type) === AccountType.TRAINEE) return true;
    if (isTrainer(u)) {
      if (hasTrainerFullAccess(u)) return false;
      if (isInGracePeriod(u)) return false;
      const step = String(u.trainer_verification?.onboarding_step ?? "");
      if (step === "under_review") return true;
    }
  }

  return false;
}

export function buildAccountRestrictedPayload(u: any) {
  const status = String(u?.status ?? "").toLowerCase();
  const isTraineeRole = String(u?.account_type) === AccountType.TRAINEE;
  return {
    status,
    account_type: u?.account_type,
    rejection_reason: isTraineeRole
      ? u?.account_rejection_reason || ""
      : u?.trainer_verification?.rejection_reason || "",
    code: status === "rejected" ? "ACCOUNT_REJECTED" : "ACCOUNT_PENDING_REVIEW",
  };
}
