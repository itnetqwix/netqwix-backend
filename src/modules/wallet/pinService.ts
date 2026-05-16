import bcrypt from "bcrypt";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import wallet_accounts from "../../model/wallet_accounts.schema";
import wallet_security_events from "../../model/wallet_security_events.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { financialAuditService } from "./financialAuditService";

const PIN_SALT_ROUNDS = 12;

export class PinService {
  private async logEvent(
    userId: string,
    walletAccountId: string | undefined,
    eventType: string,
    meta?: Record<string, unknown>
  ) {
    await wallet_security_events.create({
      user_id: userId,
      wallet_account_id: walletAccountId,
      event_type: eventType,
      metadata: meta,
    });
  }

  async setPin(userId: string, walletAccountId: string, pin: string) {
    if (!/^\d{6}$/.test(pin)) {
      throw new Error("PIN must be exactly 6 digits.");
    }
    const hash = await bcrypt.hash(pin, PIN_SALT_ROUNDS);
    await wallet_accounts.findByIdAndUpdate(walletAccountId, {
      $set: {
        pin_hash: hash,
        pin_set_at: new Date(),
        pin_failed_attempts: 0,
        pin_locked_until: null,
      },
    });
    await this.logEvent(userId, walletAccountId, "pin_set");
    await financialAuditService.log({
      action: "wallet_pin_set",
      entity_type: "wallet_account",
      entity_id: walletAccountId,
      user_id: userId as any,
    });
    return { success: true };
  }

  async verifyPin(userId: string, walletAccountId: string, pin: string) {
    const acc = await wallet_accounts
      .findById(walletAccountId)
      .select("+pin_hash pin_failed_attempts pin_locked_until pin_set_at")
      .lean();
    if (!acc) throw new Error("Wallet not found.");
    if (acc.pin_locked_until && new Date(acc.pin_locked_until) > new Date()) {
      throw new Error("Wallet PIN is locked. Try again later.");
    }
    if (!acc.pin_hash) throw new Error("Wallet PIN is not set.");

    const ok = await bcrypt.compare(pin, acc.pin_hash);
    if (!ok) {
      const attempts = (acc.pin_failed_attempts ?? 0) + 1;
      const update: Record<string, unknown> = { pin_failed_attempts: attempts };
      if (attempts >= WALLET_CONFIG.pinMaxAttempts) {
        update.pin_locked_until = new Date(
          Date.now() + WALLET_CONFIG.pinLockMinutes * 60 * 1000
        );
        await this.logEvent(userId, walletAccountId, "pin_locked", { attempts });
      }
      await wallet_accounts.findByIdAndUpdate(walletAccountId, { $set: update });
      await this.logEvent(userId, walletAccountId, "pin_verify_fail", { attempts });
      throw new Error("Invalid PIN.");
    }

    await wallet_accounts.findByIdAndUpdate(walletAccountId, {
      $set: { pin_failed_attempts: 0, pin_locked_until: null },
    });
    await this.logEvent(userId, walletAccountId, "pin_verify_success");

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
      throw new Error("JWT_SECRET is not configured.");
    }
    const token = jwt.sign(
      { sub: userId, wid: walletAccountId, typ: "wallet_pin" },
      secret,
      { expiresIn: `${WALLET_CONFIG.pinSessionTtlMinutes}m`, algorithm: "HS256" }
    );
    await this.logEvent(userId, walletAccountId, "pin_session_issued");
    return { pinSessionToken: token, expiresInMinutes: WALLET_CONFIG.pinSessionTtlMinutes };
  }

  verifyPinSessionToken(token: string): { userId: string; walletAccountId: string } {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
      throw new Error("JWT_SECRET is not configured.");
    }
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    }) as { sub: string; wid: string; typ: string };
    if (decoded.typ !== "wallet_pin") throw new Error("Invalid pin session.");
    return { userId: decoded.sub, walletAccountId: decoded.wid };
  }

  /** Forgot PIN: requires email OTP verified externally; issues reset token */
  async requestPinReset(userId: string, walletAccountId: string) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    await this.logEvent(userId, walletAccountId, "pin_reset_requested", {
      resetTokenHash: crypto.createHash("sha256").update(resetToken).digest("hex"),
    });
    return { resetToken, expiresInMinutes: 30 };
  }

  async confirmPinReset(
    userId: string,
    walletAccountId: string,
    newPin: string,
    resetToken?: string
  ) {
    if (!resetToken) {
      throw new Error("PIN reset token is required.");
    }
    const expectedHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const recent = await wallet_security_events
      .findOne({
        user_id: userId,
        wallet_account_id: walletAccountId,
        event_type: "pin_reset_requested",
      })
      .sort({ createdAt: -1 })
      .lean();
    const storedHash = (recent?.metadata as any)?.resetTokenHash;
    if (!storedHash || storedHash !== expectedHash) {
      throw new Error("Invalid or expired PIN reset token.");
    }
    await this.setPin(userId, walletAccountId, newPin);
    await this.logEvent(userId, walletAccountId, "pin_reset_completed");
    return { success: true };
  }
}

export const pinService = new PinService();
