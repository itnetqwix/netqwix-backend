import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const escrowHoldSchema = new Schema(
  {
    session_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.booked_sessions,
      required: true,
      index: true,
    },
    trainee_id: { type: Schema.Types.ObjectId, ref: "user", required: true },
    trainer_id: { type: Schema.Types.ObjectId, ref: "user", required: true },
    trainee_wallet_id: { type: Schema.Types.ObjectId, ref: Tables.wallet_accounts },
    currency: { type: String, default: "USD" },
    gross_minor: { type: Number, required: true },
    platform_fee_minor: { type: Number, default: 0 },
    trainer_net_minor: { type: Number, required: true },
    session_subtotal_minor: { type: Number, default: 0 },
    trainee_platform_fee_minor: { type: Number, default: 0 },
    trainer_platform_fee_minor: { type: Number, default: 0 },
    processing_fee_minor: { type: Number, default: 0 },
    tax_minor: { type: Number, default: 0 },
    charge_total_minor: { type: Number, default: 0 },
    commission_rate: { type: Number, default: 0.15 },
    pricing_config_version: { type: Number, default: 1 },
    fee_breakdown: { type: Schema.Types.Mixed },
    funding_source: {
      type: String,
      enum: ["wallet", "card", "mixed"],
      default: "card",
    },
    stripe_payment_intent_id: { type: String, index: true, sparse: true },
    ledger_hold_entry_ids: [{ type: String }],
    status: {
      type: String,
      enum: ["held", "releasing", "released", "refunded", "disputed", "cancelled"],
      default: "held",
      index: true,
    },
    release_eligible_at: { type: Date },
    released_at: { type: Date },
    release_reason: { type: String },
    parent_hold_id: { type: Schema.Types.ObjectId, ref: Tables.escrow_holds },
    kind: { type: String, enum: ["booking", "extension"], default: "booking" },
  },
  { timestamps: true }
);

export default Model(Tables.escrow_holds, escrowHoldSchema);
