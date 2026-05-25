import { Types } from "mongoose";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import ChatConversation from "../../model/chat_conversation.schema";
import ChatMessage from "../../model/chat_message.schema";
import User from "../../model/user.schema";
import ScheduledChatMessage from "../../model/scheduled_chat_message.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { EVENTS } from "../../config/constance";
import { getIo } from "../socket/socket.service";
import { ChatService } from "./chatService";

dotenv.config();

/** Small set of allowed emoji reactions. Keep this tight so the UI bar
 *  matches and we don't have to worry about unicode jank. */
const ALLOWED_REACTIONS = new Set([
  "👍",
  "❤️",
  "😂",
  "🎉",
  "🙏",
  "🔥",
  "😢",
  "😡",
]);

/** Singleton lazy OpenAI client — same pattern as `ai-service.ts`. */
let _client: OpenAI | null = null;
function openai(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function emitConv(conversationId: string, event: string, payload: any) {
  const io = getIo();
  if (!io) return;
  io.to(`chat:${conversationId}`).emit(event, payload);
}

export class ChatExtrasService {
  // ─── Reactions ────────────────────────────────────────────────
  /**
   * Toggle a single emoji reaction for the caller on a message.
   * A user can have at most one reaction per message — sending the
   * same emoji again clears it; sending a new emoji replaces it.
   */
  async toggleReaction(
    userId: string,
    messageId: string,
    emoji: string
  ): Promise<ResponseBuilder> {
    if (!ALLOWED_REACTIONS.has(emoji)) {
      return ResponseBuilder.badRequest("Reaction not allowed.");
    }
    const message: any = await ChatMessage.findById(messageId).lean();
    if (!message) return ResponseBuilder.badRequest("Message not found.");

    const conv: any = await ChatConversation.findOne({
      _id: message.conversationId,
      participants: userId,
    }).lean();
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");

    const existing = (message.reactions ?? []).find(
      (r: any) => String(r.user_id) === String(userId)
    );
    let nextReactions: any[];
    if (existing && existing.emoji === emoji) {
      nextReactions = (message.reactions ?? []).filter(
        (r: any) => String(r.user_id) !== String(userId)
      );
    } else {
      nextReactions = [
        ...((message.reactions ?? []).filter(
          (r: any) => String(r.user_id) !== String(userId)
        )),
        { user_id: new Types.ObjectId(userId), emoji },
      ];
    }
    await ChatMessage.findByIdAndUpdate(messageId, { reactions: nextReactions });

    emitConv(String(message.conversationId), EVENTS.CHAT.REACTION_UPDATED, {
      conversationId: String(message.conversationId),
      messageId: String(messageId),
      reactions: nextReactions.map((r) => ({
        user_id: String(r.user_id),
        emoji: r.emoji,
      })),
    });

    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { reactions: nextReactions };
    return rb;
  }

  // ─── Forward ──────────────────────────────────────────────────
  /**
   * Forward an existing message to multiple conversations or direct
   * recipients. We resend via the existing pipeline (so policy + push
   * + delivery semantics stay consistent) and stamp the new message
   * with `forwardedFromMessageId` for attribution in the UI.
   */
  async forwardMessage(
    senderId: string,
    messageId: string,
    targets: Array<{ conversationId?: string; otherUserId?: string }>
  ): Promise<ResponseBuilder> {
    if (!Array.isArray(targets) || !targets.length) {
      return ResponseBuilder.badRequest("targets required");
    }
    if (targets.length > 10) {
      return ResponseBuilder.badRequest("Cannot forward to more than 10 chats.");
    }
    const source: any = await ChatMessage.findById(messageId).lean();
    if (!source) return ResponseBuilder.badRequest("Message not found.");
    // sender must have been a participant of the source conversation
    const sourceConv: any = await ChatConversation.findOne({
      _id: source.conversationId,
      participants: senderId,
    }).lean();
    if (!sourceConv) return ResponseBuilder.badRequest("Cannot forward this message.");

    const chatService = new ChatService();
    const results: any[] = [];
    for (const t of targets) {
      try {
        const r = await chatService.sendMessage(
          senderId,
          t.otherUserId || "",
          source.content || "",
          source.type || "text",
          source.mediaUrl || null,
          t.conversationId || null,
          null,
          { forwardedFromMessageId: messageId }
        );
        results.push({ ok: r.code === 200, code: r.code, result: r.result });
      } catch (err: any) {
        results.push({ ok: false, error: err?.message || "send failed" });
      }
    }

    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { results };
    return rb;
  }

  // ─── Pins ─────────────────────────────────────────────────────
  async pinMessage(userId: string, messageId: string): Promise<ResponseBuilder> {
    const msg: any = await ChatMessage.findById(messageId).lean();
    if (!msg) return ResponseBuilder.badRequest("Message not found.");
    const conv: any = await ChatConversation.findOne({
      _id: msg.conversationId,
      participants: userId,
    });
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");

    conv.pinnedMessageId = msg._id;
    conv.pinnedAt = new Date();
    conv.pinnedBy = new Types.ObjectId(userId);
    await conv.save();

    emitConv(String(conv._id), EVENTS.CHAT.PINNED, {
      conversationId: String(conv._id),
      pinnedMessageId: String(msg._id),
      pinnedAt: conv.pinnedAt,
      pinnedBy: String(userId),
    });

    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = {
      pinnedMessageId: String(msg._id),
      pinnedAt: conv.pinnedAt,
      pinnedBy: String(userId),
    };
    return rb;
  }

  async unpinMessage(userId: string, conversationId: string): Promise<ResponseBuilder> {
    const conv: any = await ChatConversation.findOne({
      _id: conversationId,
      participants: userId,
    });
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");
    conv.pinnedMessageId = null;
    conv.pinnedAt = null;
    conv.pinnedBy = null;
    await conv.save();
    emitConv(String(conv._id), EVENTS.CHAT.PINNED, {
      conversationId: String(conv._id),
      pinnedMessageId: null,
    });
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { ok: true };
    return rb;
  }

  async getPinnedMessage(userId: string, conversationId: string): Promise<ResponseBuilder> {
    const conv: any = await ChatConversation.findOne({
      _id: conversationId,
      participants: userId,
    }).lean();
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");
    if (!conv.pinnedMessageId) {
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { pinned: null };
      return rb;
    }
    const pinned: any = await ChatMessage.findById(conv.pinnedMessageId)
      .populate("senderId", "fullname profile_picture")
      .lean();
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = {
      pinned: pinned
        ? {
            message: pinned,
            pinnedAt: conv.pinnedAt,
            pinnedBy: conv.pinnedBy ? String(conv.pinnedBy) : null,
          }
        : null,
    };
    return rb;
  }

  // ─── Global message search ────────────────────────────────────
  /**
   * Searches text messages across every conversation the caller is in.
   * Returns matches grouped by conversation so the chat-list level
   * "Search messages" pill can render "Sarah · ...did we book Friday's"
   * style results.
   */
  async searchAllMessages(
    userId: string,
    query: string,
    limit = 25
  ): Promise<ResponseBuilder> {
    const q = String(query || "").trim();
    if (q.length < 2) {
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { results: [] };
      return rb;
    }
    const convIds = await ChatConversation.find({ participants: userId })
      .select("_id")
      .lean();
    const ids = convIds.map((c: any) => c._id);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    const messages = await ChatMessage.find({
      conversationId: { $in: ids },
      type: "text",
      content: rx,
      deletedForAll: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 50)))
      .populate("senderId", "fullname profile_picture")
      .populate({
        path: "conversationId",
        select: "participants isGroup groupName groupAvatar",
        populate: { path: "participants", select: "fullname profile_picture account_type" },
      })
      .lean();
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { results: messages, q };
    return rb;
  }

  // ─── Voice transcription ──────────────────────────────────────
  /**
   * Lazily transcribe a voice message via OpenAI Whisper. The signed
   * mediaUrl is downloaded into memory, posted to the model, and the
   * resulting transcript persisted on the message. Idempotent: a
   * second call short-circuits to the cached transcript.
   */
  async transcribeVoiceMessage(
    userId: string,
    messageId: string
  ): Promise<ResponseBuilder> {
    const msg: any = await ChatMessage.findById(messageId);
    if (!msg) return ResponseBuilder.badRequest("Message not found.");
    if (msg.type !== "voice") return ResponseBuilder.badRequest("Not a voice message.");
    const conv: any = await ChatConversation.findOne({
      _id: msg.conversationId,
      participants: userId,
    }).lean();
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");
    if (msg.transcript && msg.transcriptStatus === "done") {
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { transcript: msg.transcript, status: "done" };
      return rb;
    }
    if (!msg.mediaUrl) {
      return ResponseBuilder.badRequest("Voice message has no media.");
    }
    msg.transcriptStatus = "pending";
    await msg.save();
    try {
      const fetched = await fetch(msg.mediaUrl);
      if (!fetched.ok) throw new Error(`download failed (${fetched.status})`);
      const buffer = Buffer.from(await fetched.arrayBuffer());
      const file = await OpenAI.toFile(buffer, `voice-${String(messageId)}.m4a`);
      const resp = await openai().audio.transcriptions.create({
        model: "whisper-1",
        file,
        response_format: "text",
      });
      const transcript = typeof resp === "string" ? resp : (resp as any)?.text || "";
      msg.transcript = transcript;
      msg.transcriptStatus = "done";
      await msg.save();
      emitConv(String(msg.conversationId), EVENTS.CHAT.TRANSCRIPT_READY, {
        conversationId: String(msg.conversationId),
        messageId: String(messageId),
        transcript,
      });
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { transcript, status: "done" };
      return rb;
    } catch (err: any) {
      msg.transcriptStatus = "failed";
      await msg.save();
      const rb = new ResponseBuilder();
      rb.code = 500;
      rb.result = { error: err?.message || "Transcription failed", status: "failed" };
      return rb;
    }
  }

  // ─── Disappearing messages ────────────────────────────────────
  async setDisappearingTtl(
    userId: string,
    conversationId: string,
    minutes: number
  ): Promise<ResponseBuilder> {
    const conv: any = await ChatConversation.findOne({
      _id: conversationId,
      participants: userId,
    });
    if (!conv) return ResponseBuilder.badRequest("Not a participant.");
    const n = Math.max(0, Math.min(60 * 24 * 30, Math.round(Number(minutes) || 0)));
    conv.disappearingTtlMinutes = n;
    await conv.save();
    emitConv(String(conv._id), EVENTS.CHAT.CONVERSATION_UPDATED, {
      conversationId: String(conv._id),
      disappearingTtlMinutes: n,
    });
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { disappearingTtlMinutes: n };
    return rb;
  }

  // ─── Read receipts opt-out ────────────────────────────────────
  async setReadReceiptsEnabled(
    userId: string,
    enabled: boolean
  ): Promise<ResponseBuilder> {
    await User.findByIdAndUpdate(userId, {
      $set: { "privacy.read_receipts_enabled": !!enabled },
    });
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { read_receipts_enabled: !!enabled };
    return rb;
  }

  // ─── Scheduled messages ───────────────────────────────────────
  /**
   * Schedule a chat message for delivery at a future timestamp. We
   * limit to 100 pending schedules per user to keep things sane.
   * The cron in `chatScheduledDispatcherJob.ts` will pick it up.
   */
  async scheduleMessage(
    senderId: string,
    payload: {
      conversationId?: string;
      receiverId?: string;
      content: string;
      type?: string;
      mediaUrl?: string | null;
      scheduledFor: string | Date;
      timezone?: string;
    }
  ): Promise<ResponseBuilder> {
    const when = new Date(payload.scheduledFor);
    if (Number.isNaN(when.getTime())) {
      return ResponseBuilder.badRequest("Invalid scheduledFor.");
    }
    if (when.getTime() <= Date.now() + 30_000) {
      return ResponseBuilder.badRequest("Schedule at least 30 seconds in the future.");
    }
    if (when.getTime() > Date.now() + 1000 * 60 * 60 * 24 * 60) {
      return ResponseBuilder.badRequest("Cannot schedule more than 60 days ahead.");
    }
    if (!payload.conversationId && !payload.receiverId) {
      return ResponseBuilder.badRequest("conversationId or receiverId required.");
    }
    if (!payload.content?.trim() && !payload.mediaUrl) {
      return ResponseBuilder.badRequest("Content or media required.");
    }
    const pendingCount = await ScheduledChatMessage.countDocuments({
      senderId,
      status: "pending",
    });
    if (pendingCount >= 100) {
      return ResponseBuilder.badRequest("Too many pending scheduled messages.");
    }
    if (payload.conversationId) {
      const conv = await ChatConversation.findOne({
        _id: payload.conversationId,
        participants: senderId,
      }).lean();
      if (!conv) return ResponseBuilder.badRequest("Conversation not accessible.");
    }
    const doc = await ScheduledChatMessage.create({
      senderId,
      conversationId: payload.conversationId || null,
      receiverId: payload.receiverId || null,
      content: payload.content || "",
      type: (payload.type as any) || "text",
      mediaUrl: payload.mediaUrl || null,
      scheduledFor: when,
      timezone: payload.timezone || "UTC",
    });
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { scheduled: doc };
    return rb;
  }

  async listScheduledMessages(senderId: string): Promise<ResponseBuilder> {
    const items = await ScheduledChatMessage.find({
      senderId,
      status: { $in: ["pending", "failed"] },
    })
      .sort({ scheduledFor: 1 })
      .populate({
        path: "conversationId",
        select: "participants isGroup groupName groupAvatar",
        populate: { path: "participants", select: "fullname profile_picture account_type" },
      })
      .populate("receiverId", "fullname profile_picture account_type")
      .lean();
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { items };
    return rb;
  }

  async cancelScheduledMessage(
    senderId: string,
    id: string
  ): Promise<ResponseBuilder> {
    const doc: any = await ScheduledChatMessage.findOne({ _id: id, senderId });
    if (!doc) return ResponseBuilder.badRequest("Not found.");
    if (doc.status !== "pending" && doc.status !== "failed") {
      return ResponseBuilder.badRequest("Cannot cancel — already dispatched.");
    }
    doc.status = "cancelled";
    await doc.save();
    const rb = new ResponseBuilder();
    rb.code = 200;
    rb.result = { ok: true };
    return rb;
  }

  /**
   * Pick up any pending scheduled messages whose time has come and
   * dispatch them through the chat send pipeline. Called from the
   * cron tick. Returns a count for diagnostics.
   */
  async dispatchDueScheduledMessages(now = new Date()): Promise<number> {
    const due = await ScheduledChatMessage.find({
      status: "pending",
      scheduledFor: { $lte: now },
    })
      .sort({ scheduledFor: 1 })
      .limit(50);
    if (!due.length) return 0;
    const chatService = new ChatService();
    let dispatched = 0;
    for (const item of due) {
      try {
        item.attempts = (item.attempts || 0) + 1;
        await item.save();
        const r = await chatService.sendMessage(
          String(item.senderId),
          item.receiverId ? String(item.receiverId) : "",
          item.content || "",
          (item.type as any) || "text",
          item.mediaUrl || null,
          item.conversationId ? String(item.conversationId) : null,
          null
        );
        if (r.code === 200) {
          item.status = "sent";
          item.sentAt = new Date();
          item.sentMessageId = r.result?.message?._id || null;
          item.lastError = null;
          await item.save();
          dispatched += 1;
        } else {
          item.lastError = JSON.stringify(r.result || {}).slice(0, 500);
          if (item.attempts >= 3) {
            item.status = "failed";
          }
          await item.save();
        }
      } catch (err: any) {
        item.lastError = String(err?.message || err).slice(0, 500);
        if ((item.attempts || 0) >= 3) item.status = "failed";
        await item.save();
      }
    }
    return dispatched;
  }
}
