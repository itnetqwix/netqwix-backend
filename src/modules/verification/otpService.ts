import * as crypto from "crypto";
import { Bcrypt } from "../../Utils/bcrypt";
import verification_otps from "../../model/verification_otps.schema";
import user from "../../model/user.schema";
import { SendEmail } from "../../Utils/sendEmail";
import SMSService from "../../services/sms-service";
import { VERIFICATION_CONFIG } from "../../config/verification";
import { logVerificationAudit } from "./verificationAudit";

const bcrypt = new Bcrypt();
const sendRate = new Map<string, number[]>();

function canSend(userId: string): boolean {
  const now = Date.now();
  const key = userId;
  const window = sendRate.get(key) || [];
  const recent = window.filter((t) => now - t < 60_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  sendRate.set(key, recent);
  return true;
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class OtpService {
  async sendOtp(userId: string, channel: "email" | "sms") {
    if (!canSend(userId)) {
      throw new Error("Too many OTP requests. Please wait a minute.");
    }

    const u = await user.findById(userId).lean();
    if (!u) throw new Error("User not found");

    const destination = channel === "email" ? u.email : u.mobile_no;
    if (!destination) throw new Error(`No ${channel} on file`);

    const code = generateCode();
    const codeHash = await bcrypt.getHashedPassword(code);
    const expiresAt = new Date(Date.now() + VERIFICATION_CONFIG.otpTtlSeconds * 1000);

    await verification_otps.deleteMany({ user_id: userId, channel, verified_at: null });
    await verification_otps.create({
      user_id: userId,
      channel,
      destination,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    });

    if (channel === "email") {
      SendEmail.sendRawEmail(
        null,
        null,
        [destination],
        "Your NetQwix verification code",
        null,
        `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in ${Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60)} minutes.</p>`
      );
    } else {
      try {
        const sms = new SMSService();
        await sms.sendSMS(destination, `Your NetQwix code is ${code}. Valid for ${Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60)} min.`);
      } catch (e) {
        console.error("[OTP] SMS failed", e);
        throw new Error("Failed to send SMS. Check your phone number.");
      }
    }

    await logVerificationAudit(userId, `otp_sent_${channel}`, { destination: destination.replace(/(.{2}).+(@.+)/, "$1***$2") });
    return { sent: true, channel, expires_at: expiresAt };
  }

  async verifyOtp(userId: string, channel: "email" | "sms", code: string) {
    const row = await verification_otps
      .findOne({ user_id: userId, channel, verified_at: null })
      .sort({ createdAt: -1 });
    if (!row) throw new Error("No active OTP. Request a new code.");
    if (row.expires_at < new Date()) throw new Error("OTP expired. Request a new code.");
    if (row.attempts >= VERIFICATION_CONFIG.otpMaxAttempts) {
      throw new Error("Too many attempts. Request a new code.");
    }

    const valid = await bcrypt.comparePassword(code, row.code_hash);
    row.attempts += 1;
    if (!valid) {
      await row.save();
      throw new Error("Invalid code.");
    }

    row.verified_at = new Date();
    await row.save();

    const update: Record<string, Date> = {};
    if (channel === "email") update["trainer_verification.email_verified_at"] = new Date();
    else update["trainer_verification.phone_verified_at"] = new Date();

    const updated = await user.findByIdAndUpdate(userId, { $set: update }, { new: true }).lean();
    await logVerificationAudit(userId, `otp_verified_${channel}`);

    const tv = updated?.trainer_verification || {};
    const emailOk = Boolean(tv.email_verified_at);
    const phoneOk = Boolean(tv.phone_verified_at);

    if (emailOk && phoneOk) {
      await user.findByIdAndUpdate(userId, {
        $set: { "trainer_verification.onboarding_step": "contact_verified" },
      });
      await logVerificationAudit(userId, "onboarding_step_contact_verified");
    }

    return { verified: true, channel, email_verified: emailOk, phone_verified: phoneOk };
  }
}

export const otpService = new OtpService();
