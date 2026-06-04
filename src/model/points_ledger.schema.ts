import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import type { PointsActionKey } from "../config/points";

const pointsLedgerSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: Tables.user, required: true, index: true },
    action_key: { type: String, required: true, index: true },
    points: { type: Number, required: true },
    balance_after: { type: Number, required: true, min: 0 },
    reference_type: {
      type: String,
      enum: ["referral", "session", "report", "review", "redemption", "admin"],
      required: true,
    },
    reference_id: { type: String, default: "" },
    idempotency_key: { type: String, required: true, unique: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

pointsLedgerSchema.index({ user_id: 1, createdAt: -1 });
pointsLedgerSchema.index({ user_id: 1, action_key: 1, createdAt: -1 });

export default Model(Tables.points_ledger, pointsLedgerSchema);

export type PointsLedgerDoc = {
  user_id: Schema.Types.ObjectId;
  action_key: PointsActionKey | string;
  points: number;
  balance_after: number;
  reference_type: string;
  reference_id?: string;
  idempotency_key: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};
