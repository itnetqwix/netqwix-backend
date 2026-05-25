/**
 * TOTP-based two-factor authentication.
 *
 * Setup flow:
 *   1. POST /user/2fa/setup        → server issues secret, returns otpauth URL + base32 (for manual entry)
 *   2. User scans QR / enters code in authenticator
 *   3. POST /user/2fa/verify       → server promotes pending secret to active + returns 10 recovery codes
 *   4. POST /user/2fa/disable      → user proves knowledge of TOTP/recovery code before disabling
 *
 * Login challenge flow (when 2FA is enabled):
 *   - `authController.login` checks `user_two_factor.enabled` and, if true,
 *     returns `{ two_factor_required: true, challenge_token: ... }` instead
 *     of a session. Client posts `/auth/2fa/challenge` with the token + code
 *     to finalise sign-in.
 */

import * as crypto from "crypto";
import user_two_factor from "../../model/user_two_factor.schema";
import user from "../../model/user.schema";
import {
  buildOtpAuthUrl,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  getTwoFactorKey,
  verifyTotp,
} from "./totp";

const RECOVERY_CODE_COUNT = 10;

function makeRecoveryCodes(): { plain: string[]; hashed: { code_hash: string; used_at: null }[] } {
  const plain: string[] = [];
  const hashed: { code_hash: string; used_at: null }[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 chars
    plain.push(`${code.slice(0, 5)}-${code.slice(5)}`);
    hashed.push({
      code_hash: crypto.createHash("sha256").update(plain[i]).digest("hex"),
      used_at: null,
    });
  }
  return { plain, hashed };
}

function decryptActiveSecret(doc: any): string | null {
  if (!doc?.secret_cipher || !doc?.secret_iv || !doc?.secret_tag) return null;
  try {
    return decryptSecret(doc.secret_cipher, doc.secret_iv, doc.secret_tag, getTwoFactorKey());
  } catch {
    return null;
  }
}

function decryptPendingSecret(doc: any): string | null {
  if (!doc?.pending_secret_cipher || !doc?.pending_secret_iv || !doc?.pending_secret_tag) return null;
  try {
    return decryptSecret(
      doc.pending_secret_cipher,
      doc.pending_secret_iv,
      doc.pending_secret_tag,
      getTwoFactorKey()
    );
  } catch {
    return null;
  }
}

export const twoFactorService = {
  async getStatus(userId: string): Promise<{ enabled: boolean; enabledAt: string | null }> {
    const doc = await user_two_factor.findOne({ user_id: userId }).lean();
    return {
      enabled: !!doc?.enabled,
      enabledAt: doc?.enabled_at ? new Date(doc.enabled_at).toISOString() : null,
    };
  },

  async beginSetup(userId: string): Promise<{ otpauthUrl: string; secret: string }> {
    const u = await user.findById(userId).select("email").lean();
    if (!u) throw new Error("User not found.");

    const { base32 } = generateTotpSecret();
    const enc = encryptSecret(base32, getTwoFactorKey());

    await user_two_factor.findOneAndUpdate(
      { user_id: userId },
      {
        $set: {
          user_id: userId,
          pending_secret_cipher: enc.cipher,
          pending_secret_iv: enc.iv,
          pending_secret_tag: enc.tag,
          pending_started_at: new Date(),
        },
        $setOnInsert: { enabled: false, method: "totp" },
      },
      { upsert: true, new: true }
    );

    const otpauthUrl = buildOtpAuthUrl({
      secret: base32,
      accountName: String(u.email ?? userId),
      issuer: "NetQwix",
    });
    return { otpauthUrl, secret: base32 };
  },

  async verifySetup(
    userId: string,
    code: string
  ): Promise<{ recoveryCodes: string[] }> {
    const doc = await user_two_factor
      .findOne({ user_id: userId })
      .select(
        "+pending_secret_cipher +pending_secret_iv +pending_secret_tag +secret_cipher +secret_iv +secret_tag"
      );
    if (!doc) throw new Error("No pending 2FA setup; start enrolment first.");

    const pending = decryptPendingSecret(doc);
    if (!pending) throw new Error("Pending secret missing or corrupted; restart enrolment.");
    if (!verifyTotp(pending, code)) throw new Error("Invalid code.");

    const { plain, hashed } = makeRecoveryCodes();
    // Re-encrypt the same secret into the active slot so we never store the
    // plaintext twice; recovery codes are stored hashed.
    const enc = encryptSecret(pending, getTwoFactorKey());

    doc.set({
      enabled: true,
      enabled_at: new Date(),
      secret_cipher: enc.cipher,
      secret_iv: enc.iv,
      secret_tag: enc.tag,
      pending_secret_cipher: null,
      pending_secret_iv: null,
      pending_secret_tag: null,
      pending_started_at: null,
      recovery_codes: hashed,
      last_verified_at: new Date(),
    });
    await doc.save();
    return { recoveryCodes: plain };
  },

  async verifyForChallenge(userId: string, code: string): Promise<boolean> {
    const doc = await user_two_factor
      .findOne({ user_id: userId, enabled: true })
      .select("+secret_cipher +secret_iv +secret_tag");
    if (!doc) return false;
    const secret = decryptActiveSecret(doc);
    if (!secret) return false;

    if (verifyTotp(secret, code)) {
      doc.last_verified_at = new Date();
      await doc.save();
      return true;
    }

    // Recovery-code path — single-use.
    const normalized = String(code).trim().toUpperCase();
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    const match = (doc.recovery_codes ?? []).find(
      (r: any) => r.code_hash === hash && !r.used_at
    );
    if (match) {
      match.used_at = new Date();
      doc.last_verified_at = new Date();
      await doc.save();
      return true;
    }
    return false;
  },

  async disable(userId: string, code: string): Promise<void> {
    const ok = await twoFactorService.verifyForChallenge(userId, code);
    if (!ok) throw new Error("Invalid code; 2FA was not disabled.");
    await user_two_factor.updateOne(
      { user_id: userId },
      {
        $set: {
          enabled: false,
          enabled_at: null,
          secret_cipher: null,
          secret_iv: null,
          secret_tag: null,
          recovery_codes: [],
        },
      }
    );
  },

  /** Used by the login controller to decide if we should issue a challenge. */
  async isEnabled(userId: string): Promise<boolean> {
    const doc = await user_two_factor.findOne({ user_id: userId, enabled: true }).select("_id").lean();
    return !!doc;
  },
};
