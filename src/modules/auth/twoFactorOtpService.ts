/**
 * Email / SMS OTP helper used by `/user/2fa/challenge` + `/user/2fa/verify`.
 *
 * Mirrors signupOtpService's storage shape (`signup_verification_otps`)
 * but with a `purpose=2fa` discriminator so signup codes and 2FA codes
 * can co-exist without colliding.
 */

import { Bcrypt } from "../../Utils/bcrypt";
import { SendEmail } from "../../Utils/sendEmail";
import SMSService from "../../services/sms-service";
import { VERIFICATION_CONFIG } from "../../config/verification";
import signup_verification_otps from "../../model/signup_verification_otps.schema";
import user from "../../model/user.schema";

const bcrypt = new Bcrypt();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const twoFactorOtpService = {
  async sendOtpToUser(
    userId: string,
    channel: "email" | "sms"
  ): Promise<{ channel: "email" | "sms"; target: string; expiresInSeconds: number }> {
    const u = await user.findById(userId).select("email mobile_no fullname").lean();
    if (!u) throw new Error("User not found.");

    const destination =
      channel === "email"
        ? String(u.email ?? "").toLowerCase()
        : String(u.mobile_no ?? "");
    if (!destination) {
      throw new Error(
        channel === "email"
          ? "Add an email to your profile before enabling 2FA."
          : "Add a phone number to your profile before enabling 2FA."
      );
    }

    const code = generateCode();
    const codeHash = await bcrypt.getHashedPassword(code);
    const expiresAt = new Date(Date.now() + VERIFICATION_CONFIG.otpTtlSeconds * 1000);

    // Reuse the signup OTP collection with a `purpose` discriminator and a
    // pseudo-destination that includes the user id, so different users
    // requesting OTP for the same email don't collide.
    const pseudoDestination = `2fa:${userId}:${destination}`;
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
        "Your NetQwix sign-in code",
        null,
        `<p>Your two-factor sign-in code is <strong>${code}</strong>.</p><p>It expires in ${Math.floor(
          VERIFICATION_CONFIG.otpTtlSeconds / 60
        )} minutes.</p>`
      );
    } else {
      const sms = new SMSService();
      await sms.sendSMS(
        destination,
        `Your NetQwix sign-in code is ${code}. Valid for ${Math.floor(
          VERIFICATION_CONFIG.otpTtlSeconds / 60
        )} min.`
      );
    }

    // Mask the destination so the client renders "j***@example.com" / "+91 ****1234".
    const maskedTarget =
      channel === "email"
        ? destination.replace(/(^.).+(@.+$)/, "$1***$2")
        : destination.replace(/.(?=.{4})/g, "*");

    return { channel, target: maskedTarget, expiresInSeconds: VERIFICATION_CONFIG.otpTtlSeconds };
  },

  async verifyOtp(userId: string, code: string): Promise<boolean> {
    const u = await user.findById(userId).select("email mobile_no").lean();
    if (!u) return false;

    // Try both channels — accept whichever has an unverified, unexpired code.
    const candidates: Array<{ destination: string; channel: "email" | "sms" }> = [];
    if (u.email) {
      candidates.push({
        destination: `2fa:${userId}:${String(u.email).toLowerCase()}`,
        channel: "email",
      });
    }
    if (u.mobile_no) {
      candidates.push({ destination: `2fa:${userId}:${String(u.mobile_no)}`, channel: "sms" });
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
