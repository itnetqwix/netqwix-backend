import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const walletSecurityEventSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    wallet_account_id: { type: Schema.Types.ObjectId, ref: Tables.wallet_accounts },
    event_type: {
      type: String,
      enum: [
        "pin_set",
        "pin_changed",
        "pin_verify_success",
        "pin_verify_fail",
        "pin_locked",
        "pin_reset_requested",
        "pin_reset_completed",
        "pin_session_issued",
        "wallet_frozen",
        "wallet_unfrozen",
        "step_up_required",
      ],
      required: true,
    },
    ip_address: { type: String },
    device_id: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default Model(Tables.wallet_security_events, walletSecurityEventSchema);
