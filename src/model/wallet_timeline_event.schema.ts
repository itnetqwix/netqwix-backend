import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Append-only event log for wallet transactions. One ledger entry can
 * have multiple events — e.g. a refund flows through:
 *   charge → refund-initiated → refund-bank → refund-completed
 *
 * Events are emitted by `instantLessonRefundService`, `topUpService`,
 * `payoutService` and the Stripe webhook handler. The mobile
 * `TransactionDetailScreen` calls `/wallet/transactions/:id/timeline`
 * and renders the events as a vertical step list.
 */
const walletTimelineEventSchema = new Schema(
  {
    /** ledger_entry._id this event belongs to (or topup/payout id). */
    reference_id: { type: Types.ObjectId, required: true, index: true },
    reference_type: {
      type: String,
      enum: ["ledger_entry", "topup", "payout", "booking"],
      required: true,
    },
    user_id: { type: Types.ObjectId, ref: Tables.user, required: true, index: true },
    /** Short kebab-key the mobile UI maps to icons + colour. */
    type: {
      type: String,
      required: true,
      enum: [
        "charge",
        "charge-failed",
        "topup-initiated",
        "topup-succeeded",
        "topup-failed",
        "refund-initiated",
        "refund-bank",
        "refund-completed",
        "refund-failed",
        "withdrawal-initiated",
        "withdrawal-bank",
        "withdrawal-paid",
        "withdrawal-failed",
        "payout-paid",
        "session-started",
        "session-completed",
      ],
    },
    label: { type: String, default: null },
    detail: { type: String, default: null },
    /** "pending" | "completed" | "failed". */
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    /** Stripe charge id / refund id / bank reference. */
    reference: { type: String, default: null },
    /** Event timestamp (defaults to insert time but can be back-dated). */
    occurred_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

walletTimelineEventSchema.index({ reference_id: 1, occurred_at: 1 });

export default Model("wallet_timeline_event", walletTimelineEventSchema);
