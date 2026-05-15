import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const financialAuditLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    entity_type: { type: String, required: true, index: true },
    entity_id: { type: String, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: "user", index: true },
    admin_id: { type: Schema.Types.ObjectId, ref: "user", index: true },
    amount_minor: { type: Number },
    currency: { type: String },
    reason: { type: String },
    meta: { type: Schema.Types.Mixed },
    idempotency_key: { type: String, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

financialAuditLogSchema.index({ createdAt: -1 });

export default Model(Tables.financial_audit_log, financialAuditLogSchema);
