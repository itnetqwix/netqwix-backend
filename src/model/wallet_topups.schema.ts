import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const walletTopupSchema = new Schema(
  {
    wallet_account_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.wallet_accounts,
      required: true,
      index: true,
    },
    user_id: { type: Schema.Types.ObjectId, ref: "user", required: true },
    amount_minor: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    stripe_payment_intent_id: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "cancelled"],
      default: "pending",
    },
    webhook_event_id: { type: String },
    idempotency_key: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

export default Model(Tables.wallet_topups, walletTopupSchema);
