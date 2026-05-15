import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const trainerVerificationAuditSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    action: { type: String, required: true },
    actor_id: { type: Schema.Types.ObjectId, ref: "user" },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

trainerVerificationAuditSchema.index({ createdAt: -1 });

export default Model(Tables.trainer_verification_audit, trainerVerificationAuditSchema);
