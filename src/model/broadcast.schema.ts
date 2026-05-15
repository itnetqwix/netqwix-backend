import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const channelStatsSchema = new Schema(
  {
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { _id: false }
);

const broadcastSchema: Schema = new Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: "" },
    html_body: { type: String, default: "" },
    channels: {
      type: [String],
      enum: ["email", "sms", "whatsapp", "in_app", "push"],
      required: true,
    },
    audience: {
      type: String,
      enum: ["Trainer", "Trainee", "All"],
      required: true,
    },
    audience_filter: {
      status: { type: [String], default: ["approved"] },
      locations: { type: [String], default: [] },
    },
    status: {
      type: String,
      enum: ["draft", "sending", "completed", "failed"],
      default: "draft",
    },
    scheduled_at: { type: Date, default: null },
    sent_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
    },
    stats: {
      total_recipients: { type: Number, default: 0 },
      email: { type: channelStatsSchema, default: () => ({}) },
      sms: { type: channelStatsSchema, default: () => ({}) },
      whatsapp: { type: channelStatsSchema, default: () => ({}) },
      in_app: { type: channelStatsSchema, default: () => ({}) },
      push: { type: channelStatsSchema, default: () => ({}) },
    },
    delivery_log: [
      {
        user_id: { type: Schema.Types.ObjectId, ref: Tables.user },
        channel: { type: String },
        status: { type: String, enum: ["sent", "failed"] },
        error: { type: String, default: null },
        sent_at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

broadcastSchema.index({ created_by: 1, createdAt: -1 });
broadcastSchema.index({ status: 1 });

export default Model(Tables.broadcast, broadcastSchema);
