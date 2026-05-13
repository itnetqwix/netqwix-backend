import ChatConversation from "../../model/chat_conversation.schema";
import ChatMessage from "../../model/chat_message.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";

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
    mediaUrl: string | null = null
  ): Promise<ResponseBuilder> {
    try {
      let conversation: any = await ChatConversation.findOne({
        participants: { $all: [senderId, receiverId], $size: 2 },
      });
      if (!conversation) {
        conversation = await ChatConversation.create({
          participants: [senderId, receiverId],
        });
      }
      const message = await ChatMessage.create({
        conversationId: conversation._id,
        senderId,
        receiverId,
        content,
        type,
        mediaUrl,
      });
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
