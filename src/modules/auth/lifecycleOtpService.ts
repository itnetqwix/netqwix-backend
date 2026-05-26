/**
 * Generic OTP helper for account-lifecycle flows that need an email/SMS
 * confirmation step (account deletion gate, hibernation, wake-up).
 *
 * Mirrors `twoFactorOtpService` but accepts a `purpose` discriminator so
 * codes for different flows never collide in `signup_verification_otps`.
 *
 *   purpose=delete:<userId>:<contact>   — confirming account deletion
 *   purpose=hibernate:<userId>:<contact>— confirming entering hibernation
 *   purpose=wake:<userId>:<contact>     — waking up from hibernation
 */

import { Bcrypt } from "../../Utils/bcrypt";
import { SendEmail } from "../../Utils/sendEmail";
import SMSService from "../../services/sms-service";
import { VERIFICATION_CONFIG } from "../../config/verification";
import signup_verification_otps from "../../model/signup_verification_otps.schema";
import user from "../../model/user.schema";

const bcrypt = new Bcrypt();

export type LifecycleOtpPurpose = "delete" | "hibernate" | "wake";

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function emailSubjectFor(purpose: LifecycleOtpPurpose): string {
  switch (purpose) {
    case "delete":
      return "Confirm your NetQwix account deletion";
    case "hibernate":
      return "Confirm pausing your NetQwix account";
    case "wake":
      return "Welcome back — your NetQwix sign-in code";
  }
}

function emailBodyFor(purpose: LifecycleOtpPurpose, code: string): string {
  const ttlMin = Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60);
  if (purpose === "delete") {
    return `<p>Your account-deletion confirmation code is <strong>${code}</strong>.</p>
            <p>Enter it in the NetQwix app within ${ttlMin} minutes to finalise deletion.
            If you didn't ask for this, ignore this email and consider changing your password.</p>`;
  }
  if (purpose === "hibernate") {
    return `<p>Your hibernation confirmation code is <strong>${code}</strong>.</p>
            <p>Enter it in the app within ${ttlMin} minutes to pause your account.
            You'll be able to come back any time with another verification code.</p>`;
  }
  return `<p>Welcome back! Your NetQwix wake-up code is <strong>${code}</strong>.</p>
          <p>Enter it within ${ttlMin} minutes to reactivate your account.</p>`;
}

function smsBodyFor(purpose: LifecycleOtpPurpose, code: string): string {
  const ttlMin = Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60);
  if (purpose === "delete") {
    return `NetQwix: ${code} is your account-deletion code. Valid ${ttlMin} min.`;
  }
  if (purpose === "hibernate") {
    return `NetQwix: ${code} is your hibernation code. Valid ${ttlMin} min.`;
  }
  return `NetQwix: ${code} is your wake-up code. Valid ${ttlMin} min.`;
}

function maskTarget(channel: "email" | "sms", destination: string): string {
  if (channel === "email") {
    return destination.replace(/(^.).+(@.+$)/, "$1***$2");
  }
  return destination.replace(/.(?=.{4})/g, "*");
}

export const lifecycleOtpService = {
  async sendOtpToUser(
    userId: string,
    channel: "email" | "sms",
    purpose: LifecycleOtpPurpose
  ): Promise<{ channel: "email" | "sms"; target: string; expiresInSeconds: number }> {
    const u = await user.findById(userId).select("email mobile_no fullname").lean();
    if (!u) throw new Error("Account not found.");

    const destination =
      channel === "email"
        ? String(u.email ?? "").toLowerCase()
        : String(u.mobile_no ?? "");
    if (!destination) {
      throw new Error(
        channel === "email"
          ? "No email on file for this account."
          : "No phone number on file for this account."
      );
    }

    const code = generateCode();
    const codeHash = await bcrypt.getHashedPassword(code);
    const expiresAt = new Date(
      Date.now() + VERIFICATION_CONFIG.otpTtlSeconds * 1000
    );

    const pseudoDestination = `${purpose}:${userId}:${destination}`;
    await signup_verification_otps.deleteMany({
      destination: pseudoDestination,
      channel,
      verified_at: null,
    });
    await signup_verification_otps.create({
      destination: pseudoDestination,
      channel,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    });

    if (channel === "email") {
      SendEmail.sendRawEmail(
        null,
        null,
        [destination],
        emailSubjectFor(purpose),
        null,
        emailBodyFor(purpose, code)
      );
    } else {
      const sms = new SMSService();
      await sms.sendSMS(destination, smsBodyFor(purpose, code));
    }

    return {
      channel,
      target: maskTarget(channel, destination),
      expiresInSeconds: VERIFICATION_CONFIG.otpTtlSeconds,
    };
  },

  async verifyOtp(
    userId: string,
    code: string,
    purpose: LifecycleOtpPurpose
  ): Promise<boolean> {
    const u = await user.findById(userId).select("email mobile_no").lean();
    if (!u) return false;
    const candidates: Array<{ destination: string; channel: "email" | "sms" }> = [];
    if (u.email) {
      candidates.push({
        destination: `${purpose}:${userId}:${String(u.email).toLowerCase()}`,
        channel: "email",
      });
    }
    if (u.mobile_no) {
      candidates.push({
        destination: `${purpose}:${userId}:${String(u.mobile_no)}`,
        channel: "sms",
      });
    }
    for (const c of candidates) {
      const row = await signup_verification_otps
        .findOne({
          destination: c.destination,
          channel: c.channel,
          verified_at: null,
          expires_at: { $gt: new Date() },
        })
        .sort({ createdAt: -1 });
      if (!row) continue;
      const ok = await bcrypt.comparePassword(code, row.code_hash);
      if (ok) {
        row.verified_at = new Date();
        await row.save();
        return true;
      }
      row.attempts = (row.attempts ?? 0) + 1;
      await row.save();
    }
    return false;
  },
};
