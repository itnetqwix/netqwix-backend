import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const pointsRedemptionSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: Tables.user, required: true, index: true },
    points_spent: { type: Number, required: true, min: 1 },
    amount_minor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    wallet_ledger_idempotency_key: { type: String, required: true },
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
  },
  { timestamps: true }
);

export default Model(Tables.points_redemption, pointsRedemptionSchema);
