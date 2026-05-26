/**
 * Account hibernation (Phase 2 item 16).
 *
 * Hibernation is a user-initiated "pause" of the account — different from
 * deletion in that the data stays intact and the user can come back any
 * time by completing a fresh email/SMS OTP "wake-up".
 *
 *   enterHibernate(userId, channel)
 *     Sends an OTP. The account is *not* yet hibernated.
 *
 *   confirmHibernate(userId, otp, reason?)
 *     Verifies OTP and sets `hibernated_at`. Revokes all sessions so the
 *     user immediately drops to the auth flow.
 *
 *   startWakeUp(emailOrPhone)
 *     Looks up the user by email/phone. If hibernated, sends a wake OTP
 *     and returns a masked target. We do NOT leak whether the account
 *     exists when it's not hibernated.
 *
 *   confirmWakeUp(userId, code)
 *     Clears `hibernated_at`. The caller can then log in normally.
 */

import user from "../../model/user.schema";
import { lifecycleOtpService } from "../auth/lifecycleOtpService";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { AccountType } from "../auth/authEnum";

export class HibernationService {
  /** Step 1 — send OTP to confirm entering hibernation. */
  public async enterHibernate(
    userId: string,
    channel: "email" | "sms" = "email"
  ): Promise<ResponseBuilder> {
    if (!userId) return ResponseBuilder.badRequest("Not authenticated");
    const target = await user
      .findById(userId)
      .select("account_type email mobile_no deleted_at hibernated_at")
      .lean();
    if (!target) return ResponseBuilder.badRequest("Account not found");
    if (target.account_type === AccountType.ADMIN) {
      return ResponseBuilder.badRequest("Admins cannot hibernate accounts");
    }
    if (target.deleted_at) {
      return ResponseBuilder.badRequest("Account is already deleted");
    }
    if (target.hibernated_at) {
      return ResponseBuilder.badRequest("Account is already hibernated");
    }
    if (channel === "sms" && !target.mobile_no) {
      return ResponseBuilder.badRequest(
        "Add a phone number first or choose email confirmation."
      );
    }
    try {
      const info = await lifecycleOtpService.sendOtpToUser(userId, channel, "hibernate");
      return ResponseBuilder.data(
        { otp: info },
        "Confirmation code sent. Enter it to pause your account."
      );
    } catch (err: any) {
      return ResponseBuilder.badRequest(err?.message || "Failed to send OTP");
    }
  }

  /** Step 2 — verify OTP, flip `hibernated_at`, revoke sessions. */
  public async confirmHibernate(
    userId: string,
    code: string,
    reason?: string
  ): Promise<ResponseBuilder> {
    if (!userId) return ResponseBuilder.badRequest("Not authenticated");
    const trimmed = String(code ?? "").trim();
    if (!trimmed) return ResponseBuilder.badRequest("OTP is required");
    const ok = await lifecycleOtpService.verifyOtp(userId, trimmed, "hibernate");
    if (!ok) return ResponseBuilder.badRequest("Invalid or expired code");

    const now = new Date();
    await user.updateOne(
      { _id: userId },
      {
        $set: {
          hibernated_at: now,
          hibernated_reason: reason ? String(reason).slice(0, 240) : null,
          isPrivate: true,
          showAsOnline: false,
        },
      }
    );

    try {
      const { authSessionService } = require("../auth/authSessionService");
      await authSessionService.revokeAllForUser(userId);
    } catch {
      /* non-fatal */
    }

    return ResponseBuilder.data(
      { hibernatedAt: now.toISOString() },
      "Your account is paused. Sign in again to wake it up."
    );
  }

  /**
   * Wake-up step 1 — public endpoint. Looks up the user by email or
   * phone, sends an OTP, and responds with a masked target.
   *
   * Returns `{ accountId, otp }` on success. Always responds 200 even
   * when the account isn't hibernated, to avoid leaking account state to
   * attackers — the mobile client treats absence of `accountId` as
   * "no action needed".
   */
  public async startWakeUp(
    contact: string,
    channel: "email" | "sms" = "email"
  ): Promise<ResponseBuilder> {
    const raw = String(contact ?? "").trim();
    if (!raw) return ResponseBuilder.badRequest("Email or phone is required");
    const lookup: any = {};
    if (raw.includes("@")) {
      lookup.email = raw.toLowerCase();
    } else {
      lookup.mobile_no = raw;
    }
    const target = await user
      .findOne({ ...lookup, hibernated_at: { $ne: null }, deleted_at: null })
      .select("_id email mobile_no hibernated_at")
      .lean();
    if (!target) {
      // Don't leak account state — return a benign response.
      return ResponseBuilder.data(
        { accountId: null, otp: null },
        "If a hibernated account exists, we've sent a wake-up code."
      );
    }
    try {
      const info = await lifecycleOtpService.sendOtpToUser(
        String(target._id),
        channel,
        "wake"
      );
      return ResponseBuilder.data(
        { accountId: String(target._id), otp: info },
        "Wake-up code sent."
      );
    } catch (err: any) {
      return ResponseBuilder.badRequest(err?.message || "Failed to send OTP");
    }
  }

  /** Wake-up step 2 — verify OTP and clear `hibernated_at`. */
  public async confirmWakeUp(
    userId: string,
    code: string
  ): Promise<ResponseBuilder> {
    const id = String(userId ?? "");
    const trimmed = String(code ?? "").trim();
    if (!id || !trimmed) {
      return ResponseBuilder.badRequest("Account id and code are required");
    }
    const ok = await lifecycleOtpService.verifyOtp(id, trimmed, "wake");
    if (!ok) return ResponseBuilder.badRequest("Invalid or expired code");
    await user.updateOne(
      { _id: id },
      {
        $set: {
          hibernated_at: null,
          hibernated_reason: null,
          isPrivate: false,
          showAsOnline: true,
        },
      }
    );
    return ResponseBuilder.data({ ok: true }, "Welcome back. You can sign in now.");
  }
}

export const hibernationService = new HibernationService();
