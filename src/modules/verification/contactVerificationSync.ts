import user from "../../model/user.schema";
import { AccountType, LoginType } from "../auth/authEnum";
import { isTrainer } from "./onboardingHelpers";
import { logVerificationAudit } from "./verificationAudit";

export function maskEmail(email?: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

/**
 * Email: trust password login and Google accounts (no redundant OTP after sign-in).
 * Phone: still requires SMS OTP — confirms the number on the account can receive codes.
 */
export async function syncTrustedContactVerification(
  userId: string,
  opts?: { trustEmailFromLogin?: boolean }
): Promise<void> {
  const u = await user.findById(userId);
  if (!u || !isTrainer(u)) return;

  u.trainer_verification = u.trainer_verification || {};
  const tv = u.trainer_verification;
  let changed = false;

  const isGoogle = String(u.login_type) === LoginType.GOOGLE;
  const isPasswordAccount = String(u.login_type) === LoginType.DEFAULT;

  const shouldTrustEmail =
    Boolean(u.email) &&
    !tv.email_verified_at &&
    (opts?.trustEmailFromLogin === true || isGoogle || isPasswordAccount);

  if (shouldTrustEmail) {
    tv.email_verified_at = new Date();
    changed = true;
  }

  const emailOk = Boolean(tv.email_verified_at);
  const phoneOk = Boolean(tv.phone_verified_at);
  if (emailOk && phoneOk && (tv.onboarding_step === "account_created" || !tv.onboarding_step)) {
    tv.onboarding_step = "contact_verified";
    changed = true;
  }

  if (changed) {
    u.markModified("trainer_verification");
    await u.save();
    await logVerificationAudit(userId, "contact_trusted_sync", {
      email_trusted: shouldTrustEmail,
    });
  }
}
