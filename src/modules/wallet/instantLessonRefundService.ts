import booked_session from "../../model/booked_sessions.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { releaseService } from "./releaseService";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";

/**
 * Refund escrow for a cancelled instant/scheduled session (idempotent per session).
 */
export async function refundSessionEscrow(
  sessionId: string,
  reason: string
): Promise<{ refunded: boolean; error?: string }> {
  try {
    const booking = await booked_session.findById(sessionId).lean();
    if (!booking) return { refunded: false, error: "Session not found" };

    if (booking.refund_status === "completed" || booking.refund_status === "refunded") {
      return { refunded: true };
    }

    const hold = await escrow_holds
      .findOne({ session_id: sessionId, status: { $in: ["held", "disputed"] } })
      .lean();

    let stripeRefundId: string | null = null;

    if (hold && WALLET_CONFIG.escrowEnabled) {
      await releaseService.refundHold(String(hold._id), reason);
    } else if (booking.payment_intent_id) {
      const stripe = require("stripe")(process.env.STRIPE_SECRET);
      try {
        const stripeRefund = await stripe.refunds.create({
          payment_intent: booking.payment_intent_id,
        });
        stripeRefundId = stripeRefund?.id ?? null;
      } catch (stripeErr: any) {
        console.error("[refundSessionEscrow] Stripe refund failed", stripeErr?.message);
      }
      try {
        const { recordRefundTransfer } = require("./refundTransferService");
        await recordRefundTransfer({
          sessionId,
          fundingSource: "card",
          stripeRefundId,
          traineeId: String(booking.trainee_id),
        });
      } catch (e) {
        console.error("[refundSessionEscrow] recordRefundTransfer", e);
      }
    }

    await booked_session.findByIdAndUpdate(sessionId, {
      $set: {
        refund_status: "completed",
        refund_reason: reason,
        status: BOOKED_SESSIONS_STATUS.cancel,
        instant_phase: booking.is_instant ? "cancelled" : booking.instant_phase,
      },
    });

    if (booking.trainee_id) {
      try {
        const {
          notifySessionUser,
          INSTANT_NOTIFICATION,
        } = require("../session/sessionNotificationService");
        const n = INSTANT_NOTIFICATION.refundProcessed();
        void notifySessionUser({
          receiverId: String(booking.trainee_id),
          senderId: String(booking.trainer_id || booking.trainee_id),
          title: n.title,
          description: n.description,
          bookingId: sessionId,
          kind: n.kind,
          extra: { refundReason: reason },
        });
      } catch {
        /* optional */
      }
    }

    return { refunded: true };
  } catch (err: any) {
    console.error("[refundSessionEscrow]", err);
    return { refunded: false, error: err?.message || String(err) };
  }
}

/** Process sessions marked for refund but not yet completed (24h SLA cron). */
export async function processPendingInstantRefunds(): Promise<number> {
  const pending = await booked_session
    .find({
      is_instant: true,
      status: BOOKED_SESSIONS_STATUS.cancel,
      refund_reason: { $exists: true, $ne: null },
      refund_status: { $nin: ["completed", "refunded"] },
    })
    .limit(50)
    .lean();

  let count = 0;
  for (const b of pending) {
    const res = await refundSessionEscrow(String(b._id), b.refund_reason || "auto_refund");
    if (res.refunded) count += 1;
  }
  return count;
}
