import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const chatFlagSchema: Schema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_conversation,
      required: true,
      index: true,
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_message,
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
    },
    flagType: {
      type: String,
      enum: ["keyword_match", "external_link", "phone_number", "payment_info"],
      required: true,
    },
    matchedContent: { type: String, default: "" },
    reviewStatus: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "action_taken"],
      default: "pending",
    },
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

chatFlagSchema.index({ reviewStatus: 1, createdAt: -1 });

export default Model(Tables.chat_flag, chatFlagSchema);
