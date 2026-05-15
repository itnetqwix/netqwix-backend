import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const payoutRequestSchema = new Schema(
  {
    trainer_id: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    wallet_account_id: { type: Schema.Types.ObjectId, ref: Tables.wallet_accounts },
    amount_minor: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    method: { type: String, enum: ["wallet_internal", "bank"], required: true },
    status: {
      type: String,
      enum: [
        "requested",
        "pending_approval",
        "approved",
        "processing",
        "completed",
        "failed",
        "rejected",
      ],
      default: "requested",
      index: true,
    },
    stripe_transfer_id: { type: String },
    stripe_payout_id: { type: String },
    estimated_arrival: { type: Date },
    admin_approved_by: { type: Schema.Types.ObjectId, ref: "user" },
    admin_second_approved_by: { type: Schema.Types.ObjectId, ref: "user" },
    rejection_reason: { type: String },
    idempotency_key: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

export default Model(Tables.payout_requests, payoutRequestSchema);
