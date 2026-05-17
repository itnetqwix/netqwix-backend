import { Bcrypt } from "../../Utils/bcrypt";
import { SendEmail } from "../../Utils/sendEmail";
import SMSService from "../../services/sms-service";
import { VERIFICATION_CONFIG } from "../../config/verification";
import signup_verification_otps from "../../model/signup_verification_otps.schema";
import user from "../../model/user.schema";

const bcrypt = new Bcrypt();
const sendRate = new Map<string, number[]>();

const VERIFIED_MAX_AGE_MS = 30 * 60 * 1000;

function canSend(destination: string, channel: string): boolean {
  const now = Date.now();
  const key = `${channel}:${destination}`;
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

export function normalizeSignupEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function normalizeSignupPhone(mobile: string): string {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(mobile || "").trim().startsWith("+")) return String(mobile).trim();
  return digits ? `+${digits}` : "";
}

export class SignupOtpService {
  private async assertDestinationAvailable(channel: "email" | "sms", destination: string) {
    if (channel === "email") {
      const exists = await user.exists({ email: destination });
      if (exists) throw new Error("This email is already registered. Sign in instead.");
      return;
    }
    const digits = destination.replace(/\D/g, "");
    const exists = await user.findOne({
      $or: [{ mobile_no: destination }, { mobile_no: digits }, { mobile_no: `+${digits}` }],
    });
    if (exists) throw new Error("This phone number is already registered.");
  }

  async sendOtp(channel: "email" | "sms", rawDestination: string) {
    const destination =
      channel === "email"
        ? normalizeSignupEmail(rawDestination)
        : normalizeSignupPhone(rawDestination);

    if (!destination) {
      throw new Error(channel === "email" ? "Enter a valid email." : "Enter a valid phone number.");
    }
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      throw new Error("Enter a valid email address.");
    }
    if (channel === "sms" && destination.replace(/\D/g, "").length < 10) {
      throw new Error("Enter a valid phone number (at least 10 digits).");
    }

    if (!canSend(destination, channel)) {
      throw new Error("Too many code requests. Please wait a minute.");
    }

    await this.assertDestinationAvailable(channel, destination);

    const code = generateCode();
    const codeHash = await bcrypt.getHashedPassword(code);
    const expiresAt = new Date(Date.now() + VERIFICATION_CONFIG.otpTtlSeconds * 1000);

    await signup_verification_otps.deleteMany({ destination, channel, verified_at: null });
    await signup_verification_otps.create({
      destination,
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
        "Your NetQwix verification code",
        null,
        `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in ${Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60)} minutes.</p>`
      );
    } else {
      const sms = new SMSService();
      await sms.sendSMS(
        destination,
        `Your NetQwix code is ${code}. Valid for ${Math.floor(VERIFICATION_CONFIG.otpTtlSeconds / 60)} min.`
      );
    }

    return { sent: true, channel, expires_at: expiresAt };
  }

  async verifyOtp(channel: "email" | "sms", rawDestination: string, code: string) {
    const destination =
      channel === "email"
        ? normalizeSignupEmail(rawDestination)
        : normalizeSignupPhone(rawDestination);

    const row = await signup_verification_otps
      .findOne({ destination, channel, verified_at: null })
      .sort({ createdAt: -1 });

    if (!row) throw new Error("No active code. Tap Send OTP first.");
    if (row.expires_at < new Date()) throw new Error("Code expired. Request a new one.");
    if (row.attempts >= VERIFICATION_CONFIG.otpMaxAttempts) {
      throw new Error("Too many attempts. Request a new code.");
    }

    const valid = await bcrypt.comparePassword(String(code || "").trim(), row.code_hash);
    row.attempts += 1;
    if (!valid) {
      await row.save();
      throw new Error("Invalid code.");
    }

    row.verified_at = new Date();
    await row.save();
    return { verified: true, channel };
  }

  async assertContactVerified(
    email: string,
    mobile: string,
    options?: { skipEmail?: boolean }
  ) {
    const normEmail = normalizeSignupEmail(email);
    const normPhone = normalizeSignupPhone(mobile);
    const since = new Date(Date.now() - VERIFIED_MAX_AGE_MS);

    if (!options?.skipEmail) {
      const emailRow = await signup_verification_otps
        .findOne({
          destination: normEmail,
          channel: "email",
          verified_at: { $gte: since },
        })
        .sort({ verified_at: -1 });

      if (!emailRow) {
        throw new Error("Verify your email with the code we sent before creating an account.");
      }
    }

    const phoneRow = await signup_verification_otps
      .findOne({
        destination: normPhone,
        channel: "sms",
        verified_at: { $gte: since },
      })
      .sort({ verified_at: -1 });

    if (!phoneRow) {
      throw new Error("Verify your phone number with the SMS code before creating an account.");
    }
  }
}

export const signupOtpService = new SignupOtpService();
