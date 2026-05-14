import ChatConversation from "../../model/chat_conversation.schema";
import ChatMessage from "../../model/chat_message.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { checkChatPolicy, getChatPolicyInfo } from "./chatPolicy";

export class ChatService {
  public async getConversations(userId: string): Promise<ResponseBuilder> {
    try {
      const conversations = await ChatConversation.find({
        participants: userId,
      })
        .populate("participants", "fullname profile_picture email account_type")
        .sort({ lastMessageAt: -1 })
        .lean();

      const withUnread = await Promise.all(
        conversations.map(async (c: any) => {
          const unreadCount = await ChatMessage.countDocuments({
            conversationId: c._id,
            receiverId: userId,
            isRead: false,
          });
          return { ...c, unreadCount };
        })
      );
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = withUnread;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getMessages(
    conversationId: string,
    userId: string,
    page = 1,
    limit = 50
  ): Promise<ResponseBuilder> {
    try {
      const conversation = await ChatConversation.findOne({
        _id: conversationId,
        participants: userId,
      });
      if (!conversation) {
        return ResponseBuilder.badRequest("Conversation not found.");
      }
      const skip = (page - 1) * limit;
      const messages = await ChatMessage.find({ conversationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      await ChatMessage.updateMany(
        { conversationId, receiverId: userId, isRead: false },
        { isRead: true }
      );

      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = messages.reverse();
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async sendMessage(
    senderId: string,
    receiverId: string,
    content: string,
    type = "text",
    mediaUrl: string | null = null,
    conversationId: string | null = null
  ): Promise<ResponseBuilder> {
    try {
      let conversation: any = null;
      if (conversationId) {
        conversation = await ChatConversation.findOne({
          _id: conversationId,
          participants: senderId,
        });
      }
      if (!conversation && receiverId) {
        conversation = await ChatConversation.findOne({
          participants: { $all: [senderId, receiverId], $size: 2 },
          isGroup: { $ne: true },
        });
      }
      if (!conversation && receiverId) {
        conversation = await ChatConversation.create({
          participants: [senderId, receiverId],
        });
      }
      if (!conversation) {
        return ResponseBuilder.badRequest("Conversation not found.");
      }
      const isGroup = conversation.isGroup;
      const actualReceiverId = isGroup ? null : receiverId;
      const finalReceiverId = actualReceiverId ?? receiverId;
      if (!isGroup && type === "text" && finalReceiverId) {
        const policy = await checkChatPolicy(senderId, finalReceiverId, content, String(conversation._id), null);
        if (!policy.allowed) {
          const rb = new ResponseBuilder();
          rb.code = 429;
          rb.result = {
            error: policy.reason,
            policy: {
              hasPaidSession: policy.hasPaidSession,
              dailyCount: policy.dailyCount,
              dailyLimit: policy.dailyLimit,
              remainingToday: policy.remainingToday,
            },
          };
          return rb;
        }
      }

      const message = await ChatMessage.create({
        conversationId: conversation._id,
        senderId,
        receiverId: finalReceiverId,
        content,
        type,
        mediaUrl,
      });

      if (!isGroup && type === "text" && content && finalReceiverId) {
        checkChatPolicy(senderId, finalReceiverId, content, String(conversation._id), String(message._id)).catch(() => {});
      }

      await ChatConversation.findByIdAndUpdate(conversation._id, {
        lastMessage: type === "text" ? content : `[${type}]`,
        lastMessageAt: new Date(),
        lastMessageSenderId: senderId,
      });
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { message: message, conversationId: conversation._id };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async createGroupConversation(
    creatorId: string,
    participantIds: string[],
    groupName: string
  ): Promise<ResponseBuilder> {
    try {
      const allParticipants = Array.from(new Set([creatorId, ...participantIds]));
      if (allParticipants.length < 3) {
        return ResponseBuilder.badRequest("A group must have at least 3 participants.");
      }
      const conversation = await ChatConversation.create({
        participants: allParticipants,
        isGroup: true,
        groupName,
        groupAdmin: creatorId,
      });
      const populated = await ChatConversation.findById(conversation._id)
        .populate("participants", "fullname profile_picture email account_type");
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = populated;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getChatPolicy(userId: string, otherUserId: string): Promise<ResponseBuilder> {
    try {
      const info = await getChatPolicyInfo(userId, otherUserId);
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = info;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getOrCreateConversation(
    userId: string,
    otherUserId: string
  ): Promise<ResponseBuilder> {
    try {
      let conversation: any = await ChatConversation.findOne({
        participants: { $all: [userId, otherUserId], $size: 2 },
      }).populate(
        "participants",
        "fullname profile_picture email account_type"
      );
      if (!conversation) {
        conversation = await ChatConversation.create({
          participants: [userId, otherUserId],
        });
        conversation = await ChatConversation.findById(
          conversation._id
        ).populate(
          "participants",
          "fullname profile_picture email account_type"
        );
      }
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = conversation;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }
}
