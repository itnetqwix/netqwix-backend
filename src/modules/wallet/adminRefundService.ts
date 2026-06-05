/**
 * Admin Stripe refunds — prefer escrow release path; Stripe idempotency when direct refund.
 */

import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import admin_audit from "../../model/admin_audit.schema";
import escrow_holds from "../../model/escrow_holds.schema";
import { refundSessionEscrow } from "./instantLessonRefundService";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export type AdminStripeRefundResult = {
  path: "escrow" | "stripe";
  refund?: unknown;
  escrowHoldId?: string;
};

export async function processAdminRefundByPaymentIntent(params: {
  paymentIntentId: string;
  bookingId: string;
  reason: string;
  adminUserId?: string;
}): Promise<AdminStripeRefundResult> {
  const booking: any = await booked_session.findById(params.bookingId).lean();
  if (!booking) {
    throw new Error("Booking not found");
  }
  if (String(booking.refund_status) === "refunded") {
    throw new Error("Booking is already refunded");
  }
  if (String(booking.payment_intent_id || "") !== String(params.paymentIntentId)) {
    throw new Error("Payment intent does not match this booking");
  }

  const bid = new mongoose.Types.ObjectId(params.bookingId);
  const existingRefundAudit = await admin_audit.findOne({
    entity_type: "booked_session",
    entity_id: bid,
    action: "stripe_refund",
  });
  if (existingRefundAudit) {
    throw new Error("A refund was already recorded for this booking");
  }

  const hold = await escrow_holds
    .findOne({
      session_id: params.bookingId,
      status: { $in: ["held", "disputed"] },
    })
    .lean();

  if (hold?._id) {
    await refundSessionEscrow(
      params.bookingId,
      params.reason || "admin_refund"
    );
    const auditRow = await admin_audit.create({
      admin_id: params.adminUserId,
      target_user_id: booking.trainee_id || booking.trainer_id || undefined,
      entity_type: "booked_session",
      entity_id: bid,
      action: "stripe_refund",
      reason: params.reason,
      meta: {
        payment_intent_id: params.paymentIntentId,
        path: "escrow",
        escrow_hold_id: String(hold._id),
      },
    });
    const { recordOpsEvent } = require("../ops/opsEventService");
    recordOpsEvent({
      category: "payment",
      severity: "info",
      event_type: "ADMIN_REFUND_ESCROW",
      user_id: booking.trainee_id,
      related_user_id: booking.trainer_id,
      session_id: params.bookingId,
      title: "Admin refund via escrow",
      summary: params.reason,
      payload: auditRow.meta,
      source: "admin",
      idempotency_key: `admin_audit:${auditRow._id}`,
    });
    return { path: "escrow", escrowHoldId: String(hold._id) };
  }

  const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId);
  const latest_charge = intent.latest_charge;
  if (!latest_charge) {
    throw new Error("No charge available for refund");
  }

  const idempotencyKey = `admin_refund:${params.bookingId}:${params.paymentIntentId}`;
  const refund = await stripe.refunds.create(
    {
      charge: latest_charge,
      reverse_transfer: true,
      refund_application_fee: true,
    },
    { idempotencyKey }
  );

  const auditRow = await admin_audit.create({
    admin_id: params.adminUserId,
    target_user_id: booking.trainee_id || booking.trainer_id || undefined,
    entity_type: "booked_session",
    entity_id: bid,
    action: "stripe_refund",
    reason: params.reason,
    meta: { payment_intent_id: params.paymentIntentId, stripe_refund_id: refund.id, path: "stripe" },
  });

  const { recordOpsEvent } = require("../ops/opsEventService");
  recordOpsEvent({
    category: "payment",
    severity: "info",
    event_type: "STRIPE_REFUND",
    user_id: booking.trainee_id,
    related_user_id: booking.trainer_id,
    session_id: params.bookingId,
    title: "Stripe refund processed",
    summary: params.reason,
    payload: auditRow.meta,
    source: "admin",
    idempotency_key: `admin_audit:${auditRow._id}`,
  });

  return { path: "stripe", refund };
}
