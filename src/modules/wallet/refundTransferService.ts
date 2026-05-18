import booked_session from "../../model/booked_sessions.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import payout_requests from "../../model/payout_requests.schema";
import wallet_accounts from "../../model/wallet_accounts.schema";
import { INSTANT_REFUND_SLA_MS } from "../../config/instantLesson";

export type RefundDestination = "wallet" | "card" | "bank";
export type RefundTransferStatus = "pending" | "processing" | "completed" | "failed";

export type RefundTransferDoc = {
  destination: RefundDestination;
  status: RefundTransferStatus;
  amount_minor: number;
  initiated_at: Date;
  expected_by: Date;
  completed_at?: Date | null;
  stripe_refund_id?: string | null;
  payout_request_id?: string | null;
  failure_reason?: string | null;
};

function parseAmountMinor(amount: unknown, grossMinor?: number): number {
  if (typeof grossMinor === "number" && grossMinor > 0) return grossMinor;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Persist refund transfer timeline on the booking after a refund is initiated. */
export async function recordRefundTransfer(params: {
  sessionId: string;
  amountMinor?: number;
  fundingSource: "wallet" | "card" | "mixed";
  stripeRefundId?: string | null;
  payoutRequestId?: string | null;
  traineeId?: string;
}): Promise<RefundTransferDoc | null> {
  const booking = await booked_session.findById(params.sessionId).lean();
  if (!booking) return null;

  const hold = await escrow_holds
    .findOne({ session_id: params.sessionId })
    .sort({ createdAt: -1 })
    .lean();

  const amountMinor =
    params.amountMinor ??
    parseAmountMinor(booking.amount, hold?.gross_minor);

  const initiatedAt = new Date();
  const expectedBy = new Date(initiatedAt.getTime() + INSTANT_REFUND_SLA_MS);

  let destination: RefundDestination = "wallet";
  let status: RefundTransferStatus = "completed";
  let completedAt: Date | null = initiatedAt;
  let stripeRefundId = params.stripeRefundId ?? null;
  let payoutRequestId = params.payoutRequestId ?? null;

  const source = params.fundingSource === "mixed" ? "card" : params.fundingSource;

  if (source === "card" || booking.payment_intent_id) {
    destination = "card";
    status = stripeRefundId ? "completed" : "processing";
    completedAt = stripeRefundId ? initiatedAt : null;
  } else {
    destination = "wallet";
    status = "completed";
    completedAt = initiatedAt;

    const traineeId = params.traineeId ?? String(booking.trainee_id);
    if (traineeId) {
      const wallet = await wallet_accounts
        .findOne({ user_id: traineeId, account_type: "trainee" })
        .lean();
      if (wallet?.payout_preference === "bank_standard") {
        destination = "bank";
        status = "processing";
        completedAt = null;
      }
    }
  }

  const doc: RefundTransferDoc = {
    destination,
    status,
    amount_minor: amountMinor,
    initiated_at: initiatedAt,
    expected_by: expectedBy,
    completed_at: completedAt,
    stripe_refund_id: stripeRefundId,
    payout_request_id: payoutRequestId,
    failure_reason: null,
  };

  await booked_session.findByIdAndUpdate(params.sessionId, {
    $set: { refund_transfer: doc },
  });

  return doc;
}

/** Reconcile processing card/bank refund transfers (Stripe + payout status). */
export async function reconcileProcessingRefundTransfers(): Promise<number> {
  const rows = await booked_session
    .find({
      "refund_transfer.status": "processing",
      refund_status: { $in: ["completed", "refunded"] },
    })
    .limit(50)
    .lean();

  const stripe = require("stripe")(process.env.STRIPE_SECRET);
  let updated = 0;

  for (const b of rows) {
    const rt = (b as any).refund_transfer as RefundTransferDoc | undefined;
    if (!rt) continue;

    try {
      if (rt.destination === "card" && b.payment_intent_id) {
        const refunds = await stripe.refunds.list({
          payment_intent: b.payment_intent_id,
          limit: 5,
        });
        const succeeded = refunds.data?.find(
          (r: any) => r.status === "succeeded" || r.status === "pending"
        );
        if (succeeded) {
          await booked_session.findByIdAndUpdate(b._id, {
            $set: {
              "refund_transfer.status": succeeded.status === "succeeded" ? "completed" : "processing",
              "refund_transfer.stripe_refund_id": succeeded.id,
              "refund_transfer.completed_at":
                succeeded.status === "succeeded" ? new Date() : null,
            },
          });
          updated += 1;
        } else if (rt.expected_by && new Date(rt.expected_by) < new Date()) {
          await booked_session.findByIdAndUpdate(b._id, {
            $set: {
              "refund_transfer.status": "failed",
              "refund_transfer.failure_reason": "Card refund not confirmed within SLA",
            },
          });
          updated += 1;
        }
        continue;
      }

      if (rt.destination === "bank" && rt.payout_request_id) {
        const payout = await payout_requests.findById(rt.payout_request_id).lean();
        if (payout?.status === "completed") {
          await booked_session.findByIdAndUpdate(b._id, {
            $set: {
              "refund_transfer.status": "completed",
              "refund_transfer.completed_at": new Date(),
            },
          });
          updated += 1;
        } else if (payout?.status === "failed") {
          await booked_session.findByIdAndUpdate(b._id, {
            $set: {
              "refund_transfer.status": "failed",
              "refund_transfer.failure_reason": payout.rejection_reason || "Bank transfer failed",
            },
          });
          updated += 1;
        }
        continue;
      }

      if (rt.destination === "bank" && rt.expected_by && new Date(rt.expected_by) <= new Date()) {
        await booked_session.findByIdAndUpdate(b._id, {
          $set: {
            "refund_transfer.status": "completed",
            "refund_transfer.completed_at": new Date(),
          },
        });
        updated += 1;
      }
    } catch (err) {
      console.error("[reconcileProcessingRefundTransfers]", b._id, err);
    }
  }

  return updated;
}

export function formatRefundTransferForApi(rt: any) {
  if (!rt) return null;
  return {
    destination: rt.destination,
    status: rt.status,
    amount_minor: rt.amount_minor,
    amount: rt.amount_minor != null ? rt.amount_minor / 100 : null,
    initiated_at: rt.initiated_at,
    expected_by: rt.expected_by,
    completed_at: rt.completed_at ?? null,
    stripe_refund_id: rt.stripe_refund_id ?? null,
    payout_request_id: rt.payout_request_id ? String(rt.payout_request_id) : null,
    failure_reason: rt.failure_reason ?? null,
  };
}
