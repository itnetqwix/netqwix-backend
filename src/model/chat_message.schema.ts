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
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_message,
      default: null,
    },
    editedAt: { type: Date, default: null },
    deletedForAll: { type: Boolean, default: false },
    /**
     * Emoji reactions. Capped at one reaction per (user, message) — the
     * service de-dups on write so we never need to compact server-side.
     */
    reactions: {
      type: [
        new Schema(
          {
            user_id: { type: Schema.Types.ObjectId, ref: Tables.user, required: true },
            emoji: { type: String, required: true },
          },
          { _id: false, timestamps: { createdAt: true, updatedAt: false } }
        ),
      ],
      default: [],
    },
    /** Set when the message was "forwarded" from another conversation. */
    forwardedFromMessageId: {
      type: Schema.Types.ObjectId,
      ref: Tables.chat_message,
      default: null,
    },
    /**
     * Stored transcript text + status for voice messages. We populate
     * lazily — the first time someone taps "Show transcript" we run the
     * OpenAI Whisper call and cache the result here.
     */
    transcript: { type: String, default: null },
    transcriptStatus: {
      type: String,
      enum: ["idle", "pending", "done", "failed"],
      default: "idle",
    },
    /**
     * When non-null, the message is auto-purged after this date by the
     * disappearing-messages cron. Set per-message at insert time using
     * the conversation's `disappearingTtlMinutes` setting.
     */
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default Model(Tables.chat_message, chatMessageSchema);
