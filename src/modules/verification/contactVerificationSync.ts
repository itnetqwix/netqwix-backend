import user from "../../model/user.schema";
import signup_verification_otps from "../../model/signup_verification_otps.schema";
import { AccountType, LoginType } from "../auth/authEnum";
import {
  normalizeSignupEmail,
  normalizeSignupPhone,
} from "../auth/signupOtpService";
import { isTrainer } from "./onboardingHelpers";
import { logVerificationAudit } from "./verificationAudit";

/** Signup OTP verified within this window after account creation counts as onboarding contact proof. */
const SIGNUP_OTP_TRUST_MS = 2 * 60 * 60 * 1000;
const RECENT_ACCOUNT_TRUST_MS = 7 * 24 * 60 * 60 * 1000;

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
 * If the user completed `/auth/signup/otp/*` before account creation, mirror that on
 * `trainer_verification` so onboarding does not ask for SMS/email again.
 */
export async function syncSignupOtpContactVerification(userId: string): Promise<void> {
  const u = await user.findById(userId);
  if (!u || !isTrainer(u) || !u.email || !u.mobile_no) return;

  u.trainer_verification = u.trainer_verification || {};
  const tv = u.trainer_verification;
  let changed = false;

  const createdAt = u.createdAt ? new Date(u.createdAt).getTime() : Date.now();
  const signupWindowEnd = createdAt + SIGNUP_OTP_TRUST_MS;
  const normEmail = normalizeSignupEmail(u.email);
  const normPhone = normalizeSignupPhone(u.mobile_no);
  const isGoogle = String(u.login_type) === LoginType.GOOGLE;

  const trustedAt = (verifiedAt: Date) => {
    const t = verifiedAt.getTime();
    const nearSignup = t >= createdAt - 60_000 && t <= signupWindowEnd;
    const recentAccount = Date.now() - createdAt < RECENT_ACCOUNT_TRUST_MS;
    return nearSignup || recentAccount;
  };

  if (!tv.email_verified_at && !isGoogle) {
    const emailRow = await signup_verification_otps
      .findOne({
        destination: normEmail,
        channel: "email",
        verified_at: { $ne: null },
      })
      .sort({ verified_at: -1 })
      .lean();

    if (emailRow?.verified_at && trustedAt(new Date(emailRow.verified_at))) {
      tv.email_verified_at = new Date(emailRow.verified_at);
      changed = true;
    }
  }

  if (!tv.phone_verified_at) {
    const phoneRow = await signup_verification_otps
      .findOne({
        destination: normPhone,
        channel: "sms",
        verified_at: { $ne: null },
      })
      .sort({ verified_at: -1 })
      .lean();

    if (phoneRow?.verified_at && trustedAt(new Date(phoneRow.verified_at))) {
      tv.phone_verified_at = new Date(phoneRow.verified_at);
      changed = true;
    }
  }

  const emailOk = Boolean(tv.email_verified_at);
  const phoneOk = Boolean(tv.phone_verified_at);
  if (
    emailOk &&
    phoneOk &&
    (tv.onboarding_step === "account_created" || !tv.onboarding_step)
  ) {
    tv.onboarding_step = "contact_verified";
    changed = true;
  }

  if (changed) {
    u.markModified("trainer_verification");
    await u.save();
    await logVerificationAudit(userId, "contact_signup_otp_sync", {
      email_synced: Boolean(tv.email_verified_at),
      phone_synced: Boolean(tv.phone_verified_at),
    });
  }
}

/**
 * Email: trust password login and Google accounts (no redundant OTP after sign-in).
 * Phone: trust signup SMS OTP via {@link syncSignupOtpContactVerification}; otherwise SMS OTP on onboarding.
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
