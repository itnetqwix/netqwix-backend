import booked_session from "../../model/booked_sessions.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import { REFUND_STATUS, isRefundTerminal } from "../../config/paymentStatus";
import { releaseService } from "./releaseService";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { walletTimelineService } from "./walletTimelineService";

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

    if (isRefundTerminal(booking.refund_status)) {
      return { refunded: true };
    }

    const paidAmount = Number(booking.amount ?? booking.charging_price ?? 0);
    const hasFunding =
      !!booking.payment_intent_id ||
      !!(await escrow_holds
        .findOne({ session_id: sessionId, status: { $in: ["held", "disputed"] } })
        .select("_id")
        .lean());

    if (!hasFunding && paidAmount <= 0) {
      await booked_session.findByIdAndUpdate(sessionId, {
        $set: {
          refund_status: REFUND_STATUS.COMPLETED,
          refund_reason: reason,
          status: BOOKED_SESSIONS_STATUS.cancel,
          instant_phase: booking.is_instant ? "cancelled" : booking.instant_phase,
        },
      });
      return { refunded: true };
    }

    await booked_session.findByIdAndUpdate(sessionId, {
      $set: {
        refund_status: REFUND_STATUS.PROCESSING,
        refund_reason: reason,
      },
    });

    const hold = await escrow_holds
      .findOne({ session_id: sessionId, status: { $in: ["held", "disputed"] } })
      .lean();

    let stripeRefundId: string | null = null;
    let stripeRefundOk = false;

    if (hold && WALLET_CONFIG.escrowEnabled) {
      await releaseService.refundHold(String(hold._id), reason);
      stripeRefundOk = true;
    } else if (booking.payment_intent_id) {
      const stripe = require("stripe")(process.env.STRIPE_SECRET);
      try {
        const stripeRefund = await stripe.refunds.create({
          payment_intent: booking.payment_intent_id,
        });
        stripeRefundId = stripeRefund?.id ?? null;
        stripeRefundOk = !!stripeRefundId;
      } catch (stripeErr: any) {
        console.error("[refundSessionEscrow] Stripe refund failed", stripeErr?.message);
        await booked_session.findByIdAndUpdate(sessionId, {
          $set: {
            refund_status: REFUND_STATUS.FAILED,
            refund_reason: reason,
            status: BOOKED_SESSIONS_STATUS.cancel,
            instant_phase: booking.is_instant ? "cancelled" : booking.instant_phase,
            "refund_transfer.status": "failed",
            "refund_transfer.failure_reason": stripeErr?.message || "Stripe refund failed",
          },
        });
        return { refunded: false, error: stripeErr?.message || "Stripe refund failed" };
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

    if (!stripeRefundOk && !hold) {
      await booked_session.findByIdAndUpdate(sessionId, {
        $set: { refund_status: REFUND_STATUS.FAILED },
      });
      return { refunded: false, error: "No escrow hold or payment intent to refund" };
    }

    await booked_session.findByIdAndUpdate(sessionId, {
      $set: {
        refund_status: REFUND_STATUS.COMPLETED,
        refund_reason: reason,
        status: BOOKED_SESSIONS_STATUS.cancel,
        instant_phase: booking.is_instant ? "cancelled" : booking.instant_phase,
      },
    });

    // Emit timeline events so TransactionDetailScreen renders the refund flow.
    try {
      if (booking.trainee_id) {
        await walletTimelineService.append({
          referenceId: sessionId,
          referenceType: "booking",
          userId: String(booking.trainee_id),
          type: "refund-initiated",
          label: "Refund initiated",
          detail: reason,
        });
        await walletTimelineService.append({
          referenceId: sessionId,
          referenceType: "booking",
          userId: String(booking.trainee_id),
          type: stripeRefundId ? "refund-bank" : "refund-completed",
          label: stripeRefundId ? "Refund sent to your bank" : "Refund credited to wallet",
          reference: stripeRefundId ?? undefined,
        });
      }
    } catch {
      /* timeline is best-effort, never blocks the refund flow */
    }

    if (booking.trainee_id) {
      try {
        const latest = await booked_session
          .findById(sessionId)
          .select("refund_transfer.amount_minor")
          .lean();
        const transferMinor = Number((latest as any)?.refund_transfer?.amount_minor);
        const fallbackMinor =
          typeof (hold as any)?.gross_minor === "number"
            ? Number((hold as any).gross_minor)
            : 0;
        const processedRefundMinor =
          Number.isFinite(transferMinor) && transferMinor > 0
            ? transferMinor
            : fallbackMinor;
        if (processedRefundMinor <= 0) {
          return { refunded: true };
        }

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

/** Process cancelled sessions marked for refund but not yet completed (cron SLA). */
export async function processPendingInstantRefunds(): Promise<number> {
  const pending = await booked_session
    .find({
      status: BOOKED_SESSIONS_STATUS.cancel,
      refund_reason: { $exists: true, $ne: null },
      refund_status: {
        $nin: [REFUND_STATUS.COMPLETED, REFUND_STATUS.REFUNDED, REFUND_STATUS.FAILED],
      },
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
