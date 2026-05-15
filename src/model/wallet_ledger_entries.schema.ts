import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const walletLedgerEntrySchema = new Schema(
  {
    entry_id: { type: String, required: true, unique: true },
    idempotency_key: { type: String, required: true, unique: true },
    wallet_account_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.wallet_accounts,
      required: true,
      index: true,
    },
    entry_type: { type: String, enum: ["credit", "debit"], required: true },
    bucket: { type: String, required: true, index: true },
    amount_minor: { type: Number, required: true, min: 0 },
    counterparty_entry_id: { type: String },
    reference_type: { type: String, required: true, index: true },
    reference_id: { type: String, index: true },
    session_id: { type: Schema.Types.ObjectId, ref: Tables.booked_sessions, index: true },
    metadata: { type: Schema.Types.Mixed },
    actor: {
      type: String,
      enum: ["user", "system", "admin", "webhook"],
      default: "system",
    },
    actor_user_id: { type: Schema.Types.ObjectId, ref: "user" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

walletLedgerEntrySchema.index({ wallet_account_id: 1, createdAt: -1 });

export default Model(Tables.wallet_ledger_entries, walletLedgerEntrySchema);
