import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const adminAuditSchema: Schema = new Schema(
  {
    admin_id: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    target_user_id: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: false,
    },
    entity_type: {
      type: String,
      required: true,
      enum: ["clip", "report", "saved_session", "booked_session", "user"],
    },
    entity_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: ["soft_delete", "hard_delete"],
    },
    reason: {
      type: String,
      default: "",
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

const admin_audit = Model(Tables.admin_audit, adminAuditSchema);
export default admin_audit;
