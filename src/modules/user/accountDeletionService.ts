/**
 * Account deletion lifecycle (Phase 2 item 15).
 *
 *   1. requestDeletion(userId, password)
 *        Re-verifies password, opens a `pending` AccountDeletionRequest,
 *        sends an OTP to the user's email (or SMS fallback).
 *
 *   2. confirmDeletion(userId, otp)
 *        Verifies OTP, sets `pending_deletion_at = now`, marks the request
 *        `confirmed` with a 15-day `restore_deadline`, revokes sessions.
 *        Login remains *blocked* (login service short-circuits on
 *        `pending_deletion_at`) but the account record stays intact so
 *        admin/support can restore via the admin panel.
 *
 *   3. cancelOwnPendingDeletion(userId)
 *        User changes their mind during the 15-day window — clears
 *        `pending_deletion_at`, marks the request `cancelled`. (Not used
 *        directly because login is blocked, but exposed for emergency
 *        recovery via support / a magic-link).
 *
 *   4. adminRestore(authUserId, requestId, note?)
 *        Admin clears `pending_deletion_at`, marks the request `restored`.
 *
 *   5. processOverdueHardDeletes()
 *        Cron entry — finds all `confirmed` requests past their restore
 *        deadline and performs the irreversible soft-then-hard-delete
 *        (same scrambling that the legacy `deleteOwnAccount` did).
 */

import { Bcrypt } from "../../Utils/bcrypt";
import user from "../../model/user.schema";
import AccountDeletionRequest from "../../model/account_deletion_request.schema";
import { lifecycleOtpService } from "../auth/lifecycleOtpService";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { AccountType } from "../auth/authEnum";

const RESTORE_WINDOW_DAYS = 15;
const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const bcrypt = new Bcrypt();

export class AccountDeletionService {
  /** Re-verify password, open a pending request, send OTP. */
  public async requestDeletion(
    userId: string,
    password: string,
    reason?: string,
    feedbackCategory?: string,
    channel: "email" | "sms" = "email"
  ): Promise<ResponseBuilder> {
    if (!userId) return ResponseBuilder.badRequest("Not authenticated");
    if (!password) return ResponseBuilder.badRequest("Password is required");

    const target = await user.findById(userId).select(
      "+password account_type email fullname mobile_no deleted_at pending_deletion_at"
    );
    if (!target) return ResponseBuilder.badRequest("Account not found");
    if (target.account_type === AccountType.ADMIN) {
      return ResponseBuilder.badRequest(
        "Admin accounts must be removed by another admin"
      );
    }
    if (target.deleted_at) {
      return ResponseBuilder.badRequest("Account is already deleted");
    }
    if (target.pending_deletion_at) {
      return ResponseBuilder.badRequest(
        "Deletion is already pending. Check your email for the confirmation code."
      );
    }

    const validPassword = await bcrypt.comparePassword(password, target.password);
    if (!validPassword) {
      return ResponseBuilder.badRequest("Incorrect password");
    }

    if (channel === "sms" && !target.mobile_no) {
      return ResponseBuilder.badRequest(
        "Add a phone number first or choose email confirmation."
      );
    }

    // Open or replace the pending request — only one pending at a time.
    await AccountDeletionRequest.deleteMany({ user_id: userId, status: "pending" });
    await AccountDeletionRequest.create({
      user_id: userId,
      user_email_at_request: target.email,
      user_fullname_at_request: target.fullname,
      reason: reason ? String(reason).slice(0, 600) : null,
      feedback_category: feedbackCategory || null,
      status: "pending",
    });

    let otpInfo: { channel: string; target: string; expiresInSeconds: number };
    try {
      otpInfo = await lifecycleOtpService.sendOtpToUser(userId, channel, "delete");
    } catch (err: any) {
      return ResponseBuilder.badRequest(err?.message || "Failed to send OTP");
    }

    return ResponseBuilder.data(
      { otp: otpInfo },
      "Confirmation code sent. Enter it within 10 minutes to finalise deletion."
    );
  }

  /** Verify OTP, freeze the account, mark a 15-day restore deadline. */
  public async confirmDeletion(
    userId: string,
    code: string,
    overrideReason?: string
  ): Promise<ResponseBuilder> {
    if (!userId) return ResponseBuilder.badRequest("Not authenticated");
    const trimmed = String(code ?? "").trim();
    if (!trimmed) return ResponseBuilder.badRequest("OTP is required");

    const ok = await lifecycleOtpService.verifyOtp(userId, trimmed, "delete");
    if (!ok) return ResponseBuilder.badRequest("Invalid or expired code");

    const now = new Date();
    const restoreDeadline = new Date(now.getTime() + RESTORE_WINDOW_MS);

    // Don't hard-delete yet — just freeze and stamp the deadline. Login
    // is already blocked by `pending_deletion_at` (see authService).
    await user.updateOne(
      { _id: userId },
      {
        $set: {
          pending_deletion_at: now,
          isPrivate: true,
          showAsOnline: false,
          deletion_reason: overrideReason ? String(overrideReason).slice(0, 240) : undefined,
        },
      }
    );

    const request = await AccountDeletionRequest.findOneAndUpdate(
      { user_id: userId, status: "pending" },
      {
        $set: {
          status: "confirmed",
          confirmed_at: now,
          restore_deadline: restoreDeadline,
          reason: overrideReason ? String(overrideReason).slice(0, 600) : undefined,
        },
      },
      { new: true, upsert: true }
    );

    try {
      const { authSessionService } = require("../auth/authSessionService");
      await authSessionService.revokeAllForUser(userId);
    } catch {
      /* non-fatal */
    }

    return ResponseBuilder.data(
      {
        requestId: String(request?._id ?? ""),
        confirmedAt: now.toISOString(),
        restoreDeadline: restoreDeadline.toISOString(),
        restoreWindowDays: RESTORE_WINDOW_DAYS,
      },
      `Account scheduled for deletion. Support can restore it for ${RESTORE_WINDOW_DAYS} days.`
    );
  }

  /** Same-user cancel: clears the pending stamp. */
  public async cancelOwnPendingDeletion(userId: string): Promise<ResponseBuilder> {
    if (!userId) return ResponseBuilder.badRequest("Not authenticated");
    await user.updateOne(
      { _id: userId },
      { $set: { pending_deletion_at: null, isPrivate: false, showAsOnline: true } }
    );
    await AccountDeletionRequest.updateMany(
      { user_id: userId, status: { $in: ["pending", "confirmed"] } },
      { $set: { status: "cancelled", cancelled_at: new Date() } }
    );
    return ResponseBuilder.data({ ok: true }, "Deletion cancelled");
  }

  /** Admin restore — clears the pending stamp, marks the request restored. */
  public async adminRestore(
    adminUserId: string,
    requestId: string,
    note?: string
  ): Promise<ResponseBuilder> {
    const req = await AccountDeletionRequest.findById(requestId);
    if (!req) return ResponseBuilder.badRequest("Deletion request not found");
    if (req.status === "hard_deleted") {
      return ResponseBuilder.badRequest("Account has already been hard-deleted");
    }
    if (req.status === "restored") {
      return ResponseBuilder.data({ ok: true }, "Already restored");
    }
    await user.updateOne(
      { _id: req.user_id },
      {
        $set: {
          pending_deletion_at: null,
          isPrivate: false,
          showAsOnline: true,
        },
      }
    );
    req.status = "restored";
    req.restored_at = new Date();
    req.restored_by = adminUserId as any;
    if (note) req.admin_notes = String(note).slice(0, 600);
    await req.save();
    return ResponseBuilder.data({ ok: true }, "Account restored");
  }

  /** Cron entry — hard-deletes any account whose 15-day window has lapsed. */
  public async processOverdueHardDeletes(): Promise<{ processed: number }> {
    const now = new Date();
    const overdue = await AccountDeletionRequest.find({
      status: "confirmed",
      restore_deadline: { $lte: now },
    })
      .select("user_id")
      .limit(200)
      .lean();
    let processed = 0;
    for (const row of overdue) {
      try {
        const userId = String(row.user_id);
        const scrambled = `deleted+${userId}@netqwix.invalid`;
        await user.updateOne(
          { _id: userId },
          {
            $set: {
              deleted_at: now,
              email: scrambled,
              mobile_no: "",
              fullname: "Deleted user",
              profile_picture: null,
              chat_public_key: null,
              ai_profile_summary: null,
              isPrivate: true,
              showAsOnline: false,
            },
          }
        );
        await AccountDeletionRequest.updateOne(
          { user_id: row.user_id, status: "confirmed" },
          { $set: { status: "hard_deleted", hard_deleted_at: now } }
        );
        try {
          const { authSessionService } = require("../auth/authSessionService");
          await authSessionService.revokeAllForUser(userId);
        } catch {
          /* non-fatal */
        }
        processed += 1;
      } catch (err) {
        // Continue with the rest; log to console so cron output flags it.
        // eslint-disable-next-line no-console
        console.error("[accountDeletion] hard-delete failed for", row.user_id, err);
      }
    }
    return { processed };
  }
}

export const accountDeletionService = new AccountDeletionService();
