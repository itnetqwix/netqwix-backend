import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * A draft message a user (typically a trainer) scheduled for future
 * delivery. A cron tick scans for `status='pending' && scheduledFor<=now`
 * and dispatches via the normal chat send pipeline, after which the
 * row is marked `sent`. Failures get a single retry then go to `failed`.
 */
const scheduledChatMessageSchema = new Schema(
  {
    senderId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_conversation,
      default: null,
      index: true,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
    content: { type: String, default: "", maxlength: 4000 },
    type: {
      type: String,
      enum: ["text", "image", "video", "voice", "system"],
      default: "text",
    },
    mediaUrl: { type: String, default: null },
    scheduledFor: { type: Date, required: true, index: true },
    timezone: { type: String, default: "UTC" },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    sentMessageId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_message,
      default: null,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

scheduledChatMessageSchema.index({ status: 1, scheduledFor: 1 });

export default Model(Tables.scheduled_chat_messages, scheduledChatMessageSchema);
export type ScheduledChatMessageDoc = {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  conversationId: Types.ObjectId | null;
  receiverId: Types.ObjectId | null;
  content: string;
  type: "text" | "image" | "video" | "voice" | "system";
  mediaUrl: string | null;
  scheduledFor: Date;
  timezone: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentMessageId: Types.ObjectId | null;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
};
