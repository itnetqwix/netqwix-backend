import ChatConversation from "../../model/chat_conversation.schema";
import ChatMessage from "../../model/chat_message.schema";
import user from "../../model/user.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { checkChatPolicy, getChatPolicyInfo } from "./chatPolicy";
import { EVENTS } from "../../config/constance";
import { getIo, isUserOnline } from "../socket/socket.service";

export class ChatService {
  private getConversationClearedAt(conversation: any, userId: string): Date | null {
    const cleared = (conversation?.clearedBy ?? []).find(
      (entry: any) => String(entry?.userId) === String(userId)
    );
    return cleared?.clearedAt ? new Date(cleared.clearedAt) : null;
  }

  private async assertAllFriends(
    userId: string,
    otherIds: string[]
  ): Promise<string | null> {
    if (!otherIds.length) return null;
    const doc: any = await user.findById(userId).select("friends").lean();
    if (!doc) return "User not found.";
    const friendSet = new Set((doc.friends ?? []).map((id: any) => String(id)));
    const notFriend = otherIds.find((id) => !friendSet.has(String(id)));
    if (notFriend) return "You can only add friends to a group.";
    return null;
  }

  private async getGroupForParticipant(
    conversationId: string,
    userId: string
  ): Promise<any | null> {
    return ChatConversation.findOne({
      _id: conversationId,
      isGroup: true,
      participants: userId,
    });
  }

  public async getConversations(
    userId: string,
    archivedOnly = false
  ): Promise<ResponseBuilder> {
    try {
      const filter: Record<string, unknown> = {
        participants: userId,
        deletedBy: { $nin: [userId] },
      };
      if (archivedOnly) {
        filter.archivedBy = userId;
      } else {
        filter.archivedBy = { $nin: [userId] };
      }
      const conversations = await ChatConversation.find(filter)
        .populate("participants", "fullname profile_picture email account_type")
        .sort({ lastMessageAt: -1 })
        .lean();

      const withUnread = await Promise.all(
        conversations.map(async (c: any) => {
          const visibleAfter = this.getConversationClearedAt(c, userId);
          const visibleFilter = visibleAfter ? { createdAt: { $gt: visibleAfter } } : {};
          const unreadCount = c.isGroup
            ? await ChatMessage.countDocuments({
                conversationId: c._id,
                senderId: { $ne: userId },
                isRead: false,
                ...visibleFilter,
              })
            : await ChatMessage.countDocuments({
                conversationId: c._id,
                receiverId: userId,
                isRead: false,
                ...visibleFilter,
              });
          const participants = (c.participants ?? []).map((p: any) => {
            const pid = String(p?._id ?? p);
            return {
              ...p,
              isOnline: pid !== String(userId) ? isUserOnline(pid) : undefined,
            };
          });
          return { ...c, participants, unreadCount };
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
        deletedBy: { $nin: [userId] },
      });
      if (!conversation) {
        return ResponseBuilder.badRequest("Conversation not found.");
      }
      const skip = (page - 1) * limit;
      const visibleAfter = this.getConversationClearedAt(conversation, userId);
      const visibleFilter = visibleAfter ? { createdAt: { $gt: visibleAfter } } : {};
      const messages = await ChatMessage.find({
        conversationId,
        deletedForAll: { $ne: true },
        ...visibleFilter,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("senderId", "fullname profile_picture")
        .lean();

      const now = new Date();
      if (conversation.isGroup) {
        await ChatMessage.updateMany(
          { conversationId, senderId: { $ne: userId }, isRead: false, ...visibleFilter },
          { isRead: true, status: "read", readAt: now }
        );
      } else {
        await ChatMessage.updateMany(
          { conversationId, receiverId: userId, isRead: false, ...visibleFilter },
          { isRead: true, status: "read", readAt: now }
        );
      }

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
    conversationId: string | null = null,
    replyToMessageId: string | null = null
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
      if (!isGroup && finalReceiverId) {
        const { isChatBlocked } = require("../../helpers/chatBlockCheck");
        if (await isChatBlocked(senderId, finalReceiverId)) {
          return ResponseBuilder.badRequest("You cannot message this user.");
        }
      }
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
        replyToMessageId: replyToMessageId || null,
      });

      if (!isGroup && type === "text" && content && finalReceiverId) {
        checkChatPolicy(senderId, finalReceiverId, content, String(conversation._id), String(message._id)).catch(() => {});
      }

      await ChatConversation.findByIdAndUpdate(
        conversation._id,
        {
          $set: {
            lastMessage: type === "text" ? content : `[${type}]`,
            lastMessageAt: new Date(),
            lastMessageSenderId: senderId,
          },
          $pull: {
            deletedBy: {
              $in: (conversation.participants ?? []).map((id: any) => String(id)),
            },
          },
        }
      );

      const msgPayload: any =
        typeof (message as any)?.toObject === "function"
          ? (message as any).toObject()
          : message;
      const convId = String(conversation._id);

      if (!isGroup && finalReceiverId && isUserOnline(String(finalReceiverId))) {
        const deliveredAt = new Date();
        await ChatMessage.findByIdAndUpdate(message._id, {
          status: "delivered",
          deliveredAt,
        });
        msgPayload.status = "delivered";
        msgPayload.deliveredAt = deliveredAt;
        const io = getIo();
        if (io) {
          io.to(`chat:${convId}`).emit(EVENTS.CHAT.DELIVERED, {
            messageId: String(message._id),
            messageIds: [String(message._id)],
            conversationId: convId,
          });
        }
      }

      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { message: msgPayload, conversationId: conversation._id };
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

  public async editMessage(
    userId: string,
    messageId: string,
    content: string
  ): Promise<ResponseBuilder> {
    try {
      const msg: any = await ChatMessage.findById(messageId);
      if (!msg || String(msg.senderId) !== String(userId)) {
        return ResponseBuilder.badRequest("Message not found.");
      }
      const ageMs = Date.now() - new Date(msg.createdAt).getTime();
      if (ageMs > 30 * 60 * 1000) {
        return ResponseBuilder.badRequest("Edit window expired (30 minutes).");
      }
      msg.content = content;
      msg.editedAt = new Date();
      await msg.save();
      const io = getIo();
      if (io) {
        io.to(`chat:${msg.conversationId}`).emit(EVENTS.CHAT.MESSAGE_EDITED, {
          messageId,
          content,
          editedAt: msg.editedAt,
          conversationId: String(msg.conversationId),
        });
      }
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = msg;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async deleteMessage(
    userId: string,
    messageId: string
  ): Promise<ResponseBuilder> {
    try {
      const msg: any = await ChatMessage.findById(messageId);
      if (!msg || String(msg.senderId) !== String(userId)) {
        return ResponseBuilder.badRequest("Message not found.");
      }
      msg.deletedForAll = true;
      msg.content = "";
      await msg.save();
      const io = getIo();
      if (io) {
        io.to(`chat:${msg.conversationId}`).emit(EVENTS.CHAT.MESSAGE_DELETED, {
          messageId,
          conversationId: String(msg.conversationId),
        });
      }
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async unarchiveConversation(
    userId: string,
    conversationId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv = await ChatConversation.findOne({
        _id: conversationId,
        participants: userId,
        deletedBy: { $nin: [userId] },
      });
      if (!conv) return ResponseBuilder.badRequest("Conversation not found.");
      const archived: any[] = (conv as any).archivedBy ?? [];
      (conv as any).archivedBy = archived.filter((id) => String(id) !== String(userId));
      await conv.save();
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async archiveConversation(
    userId: string,
    conversationId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv = await ChatConversation.findOne({
        _id: conversationId,
        participants: userId,
        deletedBy: { $nin: [userId] },
      });
      if (!conv) return ResponseBuilder.badRequest("Conversation not found.");
      const archived: any[] = (conv as any).archivedBy ?? [];
      if (!archived.some((id) => String(id) === String(userId))) {
        archived.push(userId);
        (conv as any).archivedBy = archived;
        await conv.save();
      }
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv = await ChatConversation.findOne({
        _id: conversationId,
        participants: userId,
      });
      if (!conv) return ResponseBuilder.badRequest("Conversation not found.");
      await ChatConversation.findByIdAndUpdate(conversationId, {
        $addToSet: { deletedBy: userId },
        $pull: { archivedBy: userId },
      });
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async clearConversation(
    userId: string,
    conversationId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv = await ChatConversation.findOne({
        _id: conversationId,
        participants: userId,
        deletedBy: { $nin: [userId] },
      });
      if (!conv) return ResponseBuilder.badRequest("Conversation not found.");
      await ChatConversation.updateOne(
        { _id: conversationId },
        { $pull: { clearedBy: { userId } } }
      );
      await ChatConversation.updateOne(
        { _id: conversationId },
        { $push: { clearedBy: { userId, clearedAt: new Date() } } }
      );
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async createGroupWithInvites(
    creatorId: string,
    participantIds: string[],
    groupName: string,
    groupDescription = "",
    groupAvatar: string | null = null
  ): Promise<ResponseBuilder> {
    try {
      const uniqueOthers = Array.from(
        new Set(participantIds.map(String).filter((id) => id !== String(creatorId)))
      );
      if (uniqueOthers.length < 2) {
        return ResponseBuilder.badRequest("A group needs at least 2 friends to invite.");
      }
      const friendErr = await this.assertAllFriends(creatorId, uniqueOthers);
      if (friendErr) return ResponseBuilder.badRequest(friendErr);
      const conversation = await ChatConversation.create({
        participants: [creatorId],
        isGroup: true,
        groupName,
        groupDescription,
        groupAvatar,
        groupAdmin: creatorId,
        pendingInvites: uniqueOthers.map((uid) => ({
          userId: uid,
          invitedBy: creatorId,
          status: "pending",
        })),
      });
      const populated = await ChatConversation.findById(conversation._id).populate(
        "participants",
        "fullname profile_picture email account_type"
      );
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = populated;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getGroupInvites(userId: string): Promise<ResponseBuilder> {
    try {
      const convs = await ChatConversation.find({
        isGroup: true,
        pendingInvites: { $elemMatch: { userId, status: "pending" } },
      })
        .populate("participants", "fullname profile_picture")
        .lean();
      const invites = convs.map((c: any) => ({
        conversationId: c._id,
        groupName: c.groupName,
        invite: (c.pendingInvites ?? []).find(
          (i: any) => String(i.userId) === String(userId) && i.status === "pending"
        ),
      }));
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = invites;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async respondGroupInvite(
    userId: string,
    conversationId: string,
    accept: boolean
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await ChatConversation.findById(conversationId);
      if (!conv?.isGroup) return ResponseBuilder.badRequest("Group not found.");
      const invites: any[] = conv.pendingInvites ?? [];
      const idx = invites.findIndex(
        (i) => String(i.userId) === String(userId) && i.status === "pending"
      );
      if (idx < 0) return ResponseBuilder.badRequest("No pending invite.");
      if (accept) {
        invites[idx].status = "accepted";
        if (!conv.participants.some((p: any) => String(p) === String(userId))) {
          conv.participants.push(userId);
        }
      } else {
        invites[idx].status = "declined";
      }
      conv.pendingInvites = invites;
      await conv.save();
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = conv;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getGroupDetail(
    conversationId: string,
    userId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await ChatConversation.findOne({
        _id: conversationId,
        isGroup: true,
        participants: userId,
      })
        .populate("participants", "fullname profile_picture email account_type")
        .lean();
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = {
        ...conv,
        isAdmin: String(conv.groupAdmin) === String(userId),
      };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async getGroupMembers(
    conversationId: string,
    userId: string,
    search = "",
    page = 1,
    limit = 50
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await this.getGroupForParticipant(conversationId, userId);
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      const populated = await ChatConversation.findById(conversationId)
        .populate("participants", "fullname profile_picture email account_type")
        .lean();
      let members = (populated?.participants ?? []).map((p: any) => ({
        ...p,
        isAdmin: String(populated?.groupAdmin) === String(p?._id ?? p),
      }));
      const q = search.trim().toLowerCase();
      if (q) {
        members = members.filter((m: any) =>
          String(m?.fullname ?? "").toLowerCase().includes(q)
        );
      }
      const skip = (page - 1) * limit;
      const paged = members.slice(skip, skip + limit);
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = {
        members: paged,
        total: members.length,
        groupAdmin: populated?.groupAdmin,
        groupName: populated?.groupName,
        groupDescription: populated?.groupDescription ?? "",
        groupAvatar: populated?.groupAvatar,
        pendingInvites: populated?.pendingInvites ?? [],
      };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async inviteToGroup(
    conversationId: string,
    userId: string,
    participantIds: string[]
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await this.getGroupForParticipant(conversationId, userId);
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      const uniqueOthers = Array.from(
        new Set(participantIds.map(String).filter((id) => id !== String(userId)))
      );
      if (!uniqueOthers.length) {
        return ResponseBuilder.badRequest("Select at least one friend to invite.");
      }
      const friendErr = await this.assertAllFriends(userId, uniqueOthers);
      if (friendErr) return ResponseBuilder.badRequest(friendErr);
      const invites: any[] = conv.pendingInvites ?? [];
      const participantSet = new Set(
        (conv.participants ?? []).map((p: any) => String(p))
      );
      for (const uid of uniqueOthers) {
        if (participantSet.has(uid)) continue;
        const existing = invites.find(
          (i) => String(i.userId) === uid && i.status === "pending"
        );
        if (!existing) {
          invites.push({
            userId: uid,
            invitedBy: userId,
            status: "pending",
            createdAt: new Date(),
          });
        }
      }
      conv.pendingInvites = invites;
      await conv.save();
      const populated = await ChatConversation.findById(conversationId).populate(
        "participants",
        "fullname profile_picture email account_type"
      );
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = populated;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async removeGroupMember(
    conversationId: string,
    adminId: string,
    memberId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await this.getGroupForParticipant(conversationId, adminId);
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      if (String(conv.groupAdmin) !== String(adminId)) {
        return ResponseBuilder.badRequest("Only the group admin can remove members.");
      }
      if (String(memberId) === String(adminId)) {
        return ResponseBuilder.badRequest("Use Exit group to leave as admin.");
      }
      conv.participants = (conv.participants ?? []).filter(
        (p: any) => String(p) !== String(memberId)
      );
      conv.pendingInvites = (conv.pendingInvites ?? []).filter(
        (i: any) => String(i.userId) !== String(memberId)
      );
      await conv.save();
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = conv;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async exitGroup(
    conversationId: string,
    userId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await this.getGroupForParticipant(conversationId, userId);
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      const isAdmin = String(conv.groupAdmin) === String(userId);
      const others = (conv.participants ?? []).filter(
        (p: any) => String(p) !== String(userId)
      );
      if (isAdmin && others.length > 0) {
        conv.groupAdmin = others[0];
      }
      conv.participants = others;
      conv.pendingInvites = (conv.pendingInvites ?? []).filter(
        (i: any) => String(i.userId) !== String(userId)
      );
      if (!conv.participants.length) {
        await ChatMessage.deleteMany({ conversationId });
        await ChatConversation.findByIdAndDelete(conversationId);
        const rb = new ResponseBuilder();
        rb.code = 200;
        rb.result = { deleted: true };
        return rb;
      }
      await conv.save();
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { deleted: false, conversation: conv };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async updateGroup(
    conversationId: string,
    userId: string,
    patch: { groupName?: string; groupDescription?: string; groupAvatar?: string | null }
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await ChatConversation.findOne({
        _id: conversationId,
        isGroup: true,
        participants: userId,
      });
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      if (String(conv.groupAdmin) !== String(userId)) {
        return ResponseBuilder.badRequest("Only the group admin can update group info.");
      }
      if (patch.groupName?.trim()) conv.groupName = patch.groupName.trim();
      if (patch.groupDescription !== undefined) {
        conv.groupDescription = patch.groupDescription;
      }
      if (patch.groupAvatar !== undefined) conv.groupAvatar = patch.groupAvatar;
      await conv.save();
      const populated = await ChatConversation.findById(conversationId)
        .populate("participants", "fullname profile_picture email account_type")
        .lean();
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = populated;
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async deleteGroup(
    conversationId: string,
    adminId: string
  ): Promise<ResponseBuilder> {
    try {
      const conv: any = await ChatConversation.findOne({
        _id: conversationId,
        isGroup: true,
      });
      if (!conv) return ResponseBuilder.badRequest("Group not found.");
      if (String(conv.groupAdmin) !== String(adminId)) {
        return ResponseBuilder.badRequest("Only the group admin can delete this group.");
      }
      await ChatMessage.deleteMany({ conversationId });
      await ChatConversation.findByIdAndDelete(conversationId);
      const rb = new ResponseBuilder();
      rb.code = 200;
      rb.result = { ok: true };
      return rb;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }
}
