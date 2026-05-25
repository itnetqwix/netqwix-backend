import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * One auto top-up rule per wallet. When the trainee's available balance
 * dips below `threshold_minor`, the worker silently charges the user's
 * default Stripe payment method for `reload_minor` and credits the
 * wallet — mirroring how Uber, Starbucks and OYO handle auto-reload.
 *
 * The schema is intentionally narrow: one rule per `wallet_account_id`.
 * If we ever support multiple rules (e.g. weekly + threshold) we'll
 * promote `rules: [{...}]` rather than reshape this single document.
 */
const walletAutoTopupSchema = new Schema(
  {
    wallet_account_id: {
      type: Types.ObjectId,
      ref: Tables.wallet_accounts,
      required: true,
      unique: true,
      index: true,
    },
    user_id: { type: Types.ObjectId, ref: Tables.user, required: true, index: true },
    enabled: { type: Boolean, default: false },
    /** Trigger when available balance drops below this (minor units). */
    threshold_minor: { type: Number, required: true, min: 0 },
    /** Amount to reload (minor units). Server enforces the wallet's min/max. */
    reload_minor: { type: Number, required: true, min: 1 },
    /** Stripe payment_method id used for the silent charge. */
    payment_method_id: { type: String, default: null },
    /** Currency snapshot at save time, in case wallet currency changes. */
    currency: { type: String, required: true },
    last_triggered_at: { type: Date, default: null },
    last_status: {
      type: String,
      enum: ["succeeded", "failed", "pending", null],
      default: null,
    },
    /** Free-form failure reason for last_status === "failed". */
    last_error: { type: String, default: null },
    /** Idempotency safety net — never fire twice within this window. */
    cooldown_until: { type: Date, default: null },
  },
  { timestamps: true }
);

export default Model("wallet_auto_topup", walletAutoTopupSchema);
