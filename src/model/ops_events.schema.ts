import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const suggestedActionSchema = new Schema(
  {
    action: { type: String, required: true },
    label: { type: String, required: true },
    href: { type: String },
    api: { type: String },
  },
  { _id: false }
);

const opsEventSchema = new Schema(
  {
    event_id: { type: String, required: true, unique: true },
    idempotency_key: { type: String, unique: true, sparse: true },
    category: {
      type: String,
      enum: [
        "instant_lesson",
        "call",
        "connection",
        "wallet",
        "payment",
        "support",
        "system",
        "admin",
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
      index: true,
    },
    event_type: { type: String, required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: "user", index: true },
    related_user_id: { type: Schema.Types.ObjectId, ref: "user", index: true },
    session_id: { type: Schema.Types.ObjectId, ref: Tables.booked_sessions, index: true },
    booking_id: { type: Schema.Types.ObjectId, ref: Tables.booked_sessions },
    title: { type: String, required: true },
    summary: { type: String },
    payload: { type: Schema.Types.Mixed },
    source: {
      type: String,
      enum: ["client", "server", "admin", "webhook"],
      default: "server",
    },
    correlation_id: { type: String, index: true },
    resolution_status: {
      type: String,
      enum: ["open", "investigating", "resolved", "wont_fix"],
      default: "open",
      index: true,
    },
    resolved_by: { type: Schema.Types.ObjectId, ref: "user" },
    resolved_at: { type: Date },
    resolution_note: { type: String },
    suggested_actions: [suggestedActionSchema],
    source_ref: { type: String },
    source_collection: { type: String },
  },
  { timestamps: true }
);

opsEventSchema.index({ createdAt: -1 });
opsEventSchema.index({ user_id: 1, createdAt: -1 });
opsEventSchema.index({ session_id: 1, createdAt: -1 });
opsEventSchema.index({ category: 1, severity: 1, createdAt: -1 });
opsEventSchema.index({ title: "text", summary: "text" });

export default Model(Tables.ops_events, opsEventSchema);
