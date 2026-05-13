import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const chatMessageSchema: Schema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_conversation,
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
    },
    content: { type: String, default: "" },
    type: {
      type: String,
      enum: ["text", "image", "video", "voice", "system"],
      default: "text",
    },
    mediaUrl: { type: String, default: null },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });

export default Model(Tables.chat_message, chatMessageSchema);
