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
    groupDescription: { type: String, default: "" },
    archivedBy: [{ type: Schema.Types.ObjectId, ref: Tables.user }],
    pendingInvites: [
      {
        userId: { type: Schema.Types.ObjectId, ref: Tables.user },
        invitedBy: { type: Schema.Types.ObjectId, ref: Tables.user },
        status: {
          type: String,
          enum: ["pending", "accepted", "declined"],
          default: "pending",
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null },
    lastMessageSenderId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
    /**
     * Pinned message slot. Only one pin per conversation — newer pins
     * overwrite older ones. `pinnedAt` lets the UI surface "Pinned 2h ago".
     */
    pinnedMessageId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_message,
      default: null,
    },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
    /**
     * When > 0, every new message in this conversation gets
     * `expiresAt = now + N minutes` (handled in chatService.sendMessage).
     * `0` disables disappearing messages.
     */
    disappearingTtlMinutes: { type: Number, default: 0, min: 0, max: 60 * 24 * 30 },
  },
  { timestamps: true }
);

chatConversationSchema.index({ participants: 1 });
// Inbox sort: conversations for a user sorted by most recent message
chatConversationSchema.index({ participants: 1, lastMessageAt: -1 });

export default Model(Tables.chat_conversation, chatConversationSchema);
