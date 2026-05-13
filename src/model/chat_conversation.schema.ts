import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const chatConversationSchema: Schema = new Schema(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: Tables.user, required: true },
    ],
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null },
    lastMessageSenderId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
  },
  { timestamps: true }
);

chatConversationSchema.index({ participants: 1 });

export default Model(Tables.chat_conversation, chatConversationSchema);
