import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import { withIdempotency } from "../../services/idempotencyService";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export async function refundExtensionStripePaymentIntent(params: {
  sessionId: string;
  requestId: string;
  paymentIntentId: string;
  reason: string;
}): Promise<{ refunded: boolean; refundId?: string; error?: string }> {
  const { sessionId, requestId, paymentIntentId, reason } = params;
  const idemKey = `ext-stripe-refund:${paymentIntentId}`;

  try {
    return await withIdempotency(idemKey, async () => {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.status !== "succeeded") {
        return { refunded: false, error: `PI status is ${intent.status}` };
      }
      const charge = intent.latest_charge;
      if (!charge) {
        return { refunded: false, error: "No charge on payment intent" };
      }
      const chargeId = typeof charge === "string" ? charge : charge.id;
      const refund = await stripe.refunds.create({
        charge: chargeId,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: {
          sessionId: String(sessionId),
          requestId: String(requestId),
          reason: String(reason).slice(0, 200),
        },
      });

      await booked_session.updateOne(
        { _id: sessionId },
        {
          $set: {
            "extension_requests.$[elem].status": "cancelled",
            "extension_requests.$[elem].terminal_reason": reason,
            "extension_requests.$[elem].decided_at": new Date(),
          },
        },
        {
          arrayFilters: [{ "elem._id": new mongoose.Types.ObjectId(requestId) }],
        }
      );

      return { refunded: true, refundId: refund.id };
    });
  } catch (err: any) {
    if (err?.message === "IDEMPOTENCY_IN_PROGRESS") {
      return { refunded: false, error: "refund_in_progress" };
    }
    return {
      refunded: false,
      error: err?.message ? String(err.message) : "stripe_refund_failed",
    };
  }
}
