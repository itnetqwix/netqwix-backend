import mongoose from "mongoose";
const stripe = require("stripe")(process.env.STRIPE_SECRET);
import escrow_holds from "../../model/escrow_holds.schema";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { WALLET_CONFIG } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { financialAuditService } from "./financialAuditService";

export class ReleaseService {
  async checkSessionCompletion(sessionId: string): Promise<{ eligible: boolean; reason?: string }> {
    const booking = await booked_session.findById(sessionId).lean();
    if (!booking) return { eligible: false, reason: "Session not found" };

    if (booking.status === BOOKED_SESSIONS_STATUS.completed) {
      return { eligible: true };
    }

    try {
      const { getLessonTimerSnapshot } = require("../socket/socket.service");
      const timer = getLessonTimerSnapshot(sessionId);
      if (timer?.status === "ended") {
        return { eligible: true };
      }
    } catch {
      /* socket optional */
    }

    return { eligible: false, reason: "Session not completed" };
  }

  async releaseHold(holdId: string, reason: string, adminId?: string) {
    const hold = await escrow_holds.findById(holdId);
    if (!hold || hold.status !== "held") {
      throw new Error("Escrow hold not available for release.");
    }

    const completion = await this.checkSessionCompletion(String(hold.session_id));
    if (!completion.eligible && !adminId) {
      throw new Error(completion.reason || "Not eligible for release");
    }

    if (hold.release_eligible_at && new Date(hold.release_eligible_at) > new Date() && !adminId) {
      throw new Error("Clearance period not elapsed.");
    }

    hold.status = "releasing";
    await hold.save();

    const trainerWallet = await walletAccountService.getOrCreateUserWallet({
      userId: String(hold.trainer_id),
      accountType: "trainer",
      currency: hold.currency,
    });
    const platform = await walletAccountService.getOrCreatePlatformAccount(hold.currency);
    const trainer = await user
      .findById(hold.trainer_id)
      .select("stripe_account_id payout_preference")
      .lean();
    const preference =
      trainerWallet.payout_preference ?? trainer?.payout_preference ?? "wallet_fast";

    await ledgerService.post({
      idempotencyKey: `escrow:release:${hold._id}`,
      referenceType: "escrow_release",
      referenceId: String(hold._id),
      sessionId: String(hold.session_id),
      actor: adminId ? "admin" : "system",
      actorUserId: adminId,
      legs: [
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "escrow_held",
          entryType: "debit",
          amountMinor: hold.gross_minor,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(trainerWallet._id)),
          bucket:
            preference === "wallet_fast" ? "available" : "pending_release",
          entryType: "credit",
          amountMinor: hold.trainer_net_minor,
        },
        {
          walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
          bucket: "available",
          entryType: "credit",
          amountMinor: hold.platform_fee_minor,
        },
      ],
    });

    if (
      WALLET_CONFIG.escrowEnabled &&
      trainer?.stripe_account_id &&
      preference === "bank_standard"
    ) {
      try {
        await stripe.transfers.create({
          amount: hold.trainer_net_minor,
          currency: (hold.currency || "usd").toLowerCase(),
          destination: trainer.stripe_account_id,
          metadata: { session_id: String(hold.session_id), hold_id: String(hold._id) },
        });
      } catch (err) {
        console.error("[ReleaseService] Stripe transfer failed", err);
      }
    }

    hold.status = "released";
    hold.released_at = new Date();
    hold.release_reason = reason;
    await hold.save();

    await financialAuditService.log({
      action: "escrow_released",
      entity_type: "escrow_hold",
      entity_id: String(hold._id),
      admin_id: adminId as any,
      amount_minor: hold.trainer_net_minor,
      currency: hold.currency,
      reason,
    });

    return hold;
  }

  async processEligibleHolds() {
    const holds = await escrow_holds
      .find({
        status: "held",
        release_eligible_at: { $lte: new Date() },
      })
      .limit(50)
      .lean();

    const results: { holdId: string; ok: boolean; error?: string }[] = [];
    for (const h of holds) {
      try {
        const completion = await this.checkSessionCompletion(String(h.session_id));
        if (!completion.eligible) {
          results.push({ holdId: String(h._id), ok: false, error: completion.reason });
          continue;
        }
        await this.releaseHold(String(h._id), "auto_release_cron");
        results.push({ holdId: String(h._id), ok: true });
      } catch (e: any) {
        results.push({ holdId: String(h._id), ok: false, error: e?.message });
      }
    }
    return results;
  }

  async refundHold(holdId: string, reason: string, adminId?: string) {
    const hold = await escrow_holds.findById(holdId);
    if (!hold || !["held", "disputed"].includes(hold.status)) {
      throw new Error("Cannot refund this hold.");
    }

    const traineeWallet = await walletAccountService.getOrCreateUserWallet({
      userId: String(hold.trainee_id),
      accountType: "trainee",
      currency: hold.currency,
    });
    const platform = await walletAccountService.getOrCreatePlatformAccount(hold.currency);

    if (hold.funding_source === "wallet") {
      await ledgerService.post({
        idempotencyKey: `escrow:refund:${hold._id}`,
        referenceType: "refund",
        referenceId: String(hold._id),
        sessionId: String(hold.session_id),
        actor: adminId ? "admin" : "system",
        legs: [
          {
            walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
            bucket: "escrow_held",
            entryType: "debit",
            amountMinor: hold.gross_minor,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(String(traineeWallet._id)),
            bucket: "available",
            entryType: "credit",
            amountMinor: hold.gross_minor,
          },
        ],
      });
    } else if (hold.stripe_payment_intent_id) {
      await stripe.refunds.create({
        payment_intent: hold.stripe_payment_intent_id,
      });
    }

    hold.status = "refunded";
    hold.release_reason = reason;
    await hold.save();

    await financialAuditService.log({
      action: "escrow_refunded",
      entity_type: "escrow_hold",
      entity_id: String(hold._id),
      admin_id: adminId as any,
      reason,
    });

    return hold;
  }
}

export const releaseService = new ReleaseService();
