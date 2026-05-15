import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const balanceCacheSchema = new Schema(
  {
    available: { type: Number, default: 0 },
    pending_topup: { type: Number, default: 0 },
    escrow_held: { type: Number, default: 0 },
    pending_release: { type: Number, default: 0 },
    pending_payout: { type: Number, default: 0 },
  },
  { _id: false }
);

const walletAccountSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "user", index: true },
    /** PLATFORM sentinel account has null user_id */
    account_key: { type: String, default: null },
    account_type: { type: String, enum: ["trainee", "trainer", "platform"], required: true },
    currency: { type: String, required: true, default: "USD" },
    status: {
      type: String,
      enum: ["active", "frozen", "closed"],
      default: "active",
    },
    pin_hash: { type: String, select: false },
    pin_set_at: { type: Date },
    pin_failed_attempts: { type: Number, default: 0 },
    pin_locked_until: { type: Date },
    payout_preference: {
      type: String,
      enum: ["wallet_fast", "bank_standard"],
      default: "wallet_fast",
    },
    stripe_customer_id: { type: String },
    stripe_connect_account_id: { type: String },
    balance_cache: { type: balanceCacheSchema, default: () => ({}) },
    region: { type: String, default: "US" },
  },
  { timestamps: true }
);

walletAccountSchema.index(
  { user_id: 1, currency: 1 },
  { unique: true, partialFilterExpression: { user_id: { $type: "objectId" } } }
);
walletAccountSchema.index(
  { account_key: 1, currency: 1 },
  { unique: true, partialFilterExpression: { account_key: { $type: "string" } } }
);

export default Model(Tables.wallet_accounts, walletAccountSchema);
