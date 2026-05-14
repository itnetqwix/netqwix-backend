import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const chatConversationSchema: Schema = new Schema(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: Tables.user, required: true },
    ],
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: null },
    groupAvatar: { type: String, default: null },
    groupAdmin: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
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
