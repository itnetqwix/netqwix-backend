/**
 * Socket.IO chat relay handlers (persistence remains on REST /chat-send).
 */

import mongoose from "mongoose";
import { EVENTS } from "../../../config/constance";
import { MemCache } from "../../../Utils/memCache";
import user from "../../../model/user.schema";
import { publishSocketEventToChat, publishSocketEventToUser } from "../socketEmit";
import { NotificationsService } from "../../notifications/notificationsService";

const pushService = new NotificationsService();

export function registerChatSocketHandlers(socket: any): void {
  const ChatMessage = require("../../../model/chat_message.schema").default;

  socket.on(EVENTS.CHAT.JOIN, (payload: any) => {
    try {
      const { conversationId } = payload || {};
      if (!conversationId) return;
      socket.join(`chat:${conversationId}`);
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.LEAVE, (payload: any) => {
    try {
      const { conversationId } = payload || {};
      if (!conversationId) return;
      socket.leave(`chat:${conversationId}`);
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.MESSAGE, async (payload: any) => {
    try {
      const { conversationId, receiverId, senderId, _id } = payload || {};
      if (!conversationId) return;

      void publishSocketEventToChat(conversationId, EVENTS.CHAT.MESSAGE, payload);

      if (receiverId) {
        const receiverSid = MemCache.getDetail(process.env.SOCKET_CONFIG, String(receiverId));
        if (receiverSid) {
          void publishSocketEventToUser(String(receiverId), EVENTS.CHAT.MESSAGE, payload);
          if (_id && mongoose.isValidObjectId(_id)) {
            await ChatMessage.findByIdAndUpdate(_id, {
              status: "delivered",
              deliveredAt: new Date(),
            });
            socket.emit(EVENTS.CHAT.DELIVERED, { messageId: _id, conversationId });
          }
        } else {
          const senderDoc = await user.findById(senderId).select("fullname").lean();
          const senderName = (senderDoc as any)?.fullname ?? "Someone";
          const content = payload.content ?? "Sent you a message";
          const preview = content.length > 60 ? content.slice(0, 57) + "..." : content;
          void pushService.sendPushNotification(
            String(receiverId),
            senderName,
            preview,
            { kind: "chat_message", conversationId, senderId: String(senderId) }
          );
        }
      }
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.DELIVERED, async (payload: any) => {
    try {
      const { messageIds, conversationId } = payload || {};
      if (!messageIds?.length || !conversationId) return;
      const validIds = messageIds.filter((id: string) => mongoose.isValidObjectId(id));
      if (validIds.length) {
        await ChatMessage.updateMany(
          { _id: { $in: validIds }, status: "sent" },
          { status: "delivered", deliveredAt: new Date() }
        );
      }
      void publishSocketEventToChat(conversationId, EVENTS.CHAT.DELIVERED, {
        messageIds: validIds,
        conversationId,
      });
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.READ, async (payload: any) => {
    try {
      const { conversationId, readerId } = payload || {};
      if (!conversationId) return;
      const reader = String(readerId || socket?.user?._doc?._id || "");
      if (!reader) return;

      const User = require("../../../model/user.schema").default;
      const readerDoc = await User.findById(reader).select("privacy.read_receipts_enabled").lean();
      if (readerDoc?.privacy?.read_receipts_enabled === false) return;

      const now = new Date();
      await ChatMessage.updateMany(
        { conversationId, receiverId: reader, isRead: false },
        { isRead: true, status: "read", readAt: now }
      );
      void publishSocketEventToChat(conversationId, EVENTS.CHAT.READ, {
        conversationId,
        readerId: reader,
        readAt: now.toISOString(),
      });
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.TYPING, (payload: any) => {
    try {
      const { conversationId, userId } = payload || {};
      if (!conversationId) return;
      void publishSocketEventToChat(conversationId, EVENTS.CHAT.TYPING, { conversationId, userId });
    } catch {
      /* quiet */
    }
  });

  socket.on(EVENTS.CHAT.STOP_TYPING, (payload: any) => {
    try {
      const { conversationId, userId } = payload || {};
      if (!conversationId) return;
      void publishSocketEventToChat(conversationId, EVENTS.CHAT.STOP_TYPING, {
        conversationId,
        userId,
      });
    } catch {
      /* quiet */
    }
  });
}
