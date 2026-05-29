import { Request, Response } from "express";
import { ChatService } from "./chatService";
import { ChatExtrasService } from "./chatExtrasService";
import { CONSTANCE } from "../../config/constance";
import { validateChatSendBody } from "./chatSendValidator";

export class ChatController {
  private chatService = new ChatService();
  private extras = new ChatExtrasService();

  public getConversations = async (req: Request, res: Response) => {
    try {
      const archivedOnly =
        String(req.query.archived ?? "").toLowerCase() === "true" ||
        String(req.query.archived ?? "") === "1";
      const result = await this.chatService.getConversations(
        req["authUser"]["_id"],
        archivedOnly
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getMessages = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      if (!conversationId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "conversationId is required" });
      }
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const result = await this.chatService.getMessages(
        conversationId,
        req["authUser"]["_id"],
        page,
        limit
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public sendMessage = async (req: Request, res: Response) => {
    try {
      const { receiverId, content, type, mediaUrl, conversationId, replyToMessageId, clientMessageId } =
        req.body;
      if (!receiverId && !conversationId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "receiverId or conversationId is required" });
      }
      const validationError = validateChatSendBody(req.body ?? {});
      if (validationError) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: validationError });
      }
      const result = await this.chatService.sendMessage(
        req["authUser"]["_id"],
        receiverId,
        content,
        type || "text",
        mediaUrl,
        conversationId,
        replyToMessageId ?? null,
        { clientMessageId: clientMessageId ?? null }
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public editMessage = async (req: Request, res: Response) => {
    try {
      const { messageId, content } = req.body;
      const result = await this.chatService.editMessage(
        req["authUser"]["_id"],
        messageId,
        content
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public deleteMessage = async (req: Request, res: Response) => {
    try {
      const { messageId } = req.body;
      const result = await this.chatService.deleteMessage(req["authUser"]["_id"], messageId);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public archiveConversation = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.body;
      const result = await this.chatService.archiveConversation(
        req["authUser"]["_id"],
        conversationId
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public unarchiveConversation = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.body;
      const result = await this.chatService.unarchiveConversation(
        req["authUser"]["_id"],
        conversationId
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public deleteConversation = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.body;
      const result = await this.chatService.deleteConversation(
        req["authUser"]["_id"],
        conversationId
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public clearConversation = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.body;
      const result = await this.chatService.clearConversation(
        req["authUser"]["_id"],
        conversationId
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getGroupInvites = async (req: Request, res: Response) => {
    try {
      const result = await this.chatService.getGroupInvites(req["authUser"]["_id"]);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public respondGroupInvite = async (req: Request, res: Response) => {
    try {
      const { conversationId, accept } = req.body;
      const result = await this.chatService.respondGroupInvite(
        req["authUser"]["_id"],
        conversationId,
        !!accept
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public createGroupWithInvites = async (req: Request, res: Response) => {
    try {
      const { participantIds, groupName, groupDescription, groupAvatar } = req.body;
      const result = await this.chatService.createGroupWithInvites(
        req["authUser"]["_id"],
        participantIds,
        groupName?.trim(),
        groupDescription ?? "",
        groupAvatar ?? null
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public createGroup = async (req: Request, res: Response) => {
    try {
      const { participantIds, groupName } = req.body;
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length < 2) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "At least 2 other participants are required" });
      }
      if (!groupName || !groupName.trim()) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "Group name is required" });
      }
      const result = await this.chatService.createGroupConversation(
        req["authUser"]["_id"],
        participantIds,
        groupName.trim()
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getFlaggedChats = async (req: Request, res: Response) => {
    try {
      const ChatFlag = require("../../model/chat_flag.schema").default;
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const status = (req.query.status as string) || "pending";
      const flags = await ChatFlag.find({ reviewStatus: status })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("senderId", "fullname email profile_picture account_type")
        .populate("conversationId")
        .lean();
      const total = await ChatFlag.countDocuments({ reviewStatus: status });
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { flags, total, page, limit } });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public updateFlagStatus = async (req: Request, res: Response) => {
    try {
      const ChatFlag = require("../../model/chat_flag.schema").default;
      const { flagId, reviewStatus, adminNote } = req.body;
      if (!flagId || !reviewStatus) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "flagId and reviewStatus required" });
      }
      await ChatFlag.findByIdAndUpdate(flagId, { reviewStatus, adminNote: adminNote || "" });
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { message: "Flag updated" } });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getChatPolicy = async (req: Request, res: Response) => {
    try {
      const otherUserId = req.query.otherUserId as string;
      if (!otherUserId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "otherUserId is required" });
      }
      const result = await this.chatService.getChatPolicy(req["authUser"]["_id"], otherUserId);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getGroupDetail = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const result = await this.chatService.getGroupDetail(
        conversationId,
        req["authUser"]["_id"]
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getGroupMembers = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const search = String(req.query.search ?? "");
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const result = await this.chatService.getGroupMembers(
        conversationId,
        req["authUser"]["_id"],
        search,
        page,
        limit
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public inviteToGroup = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { participantIds } = req.body;
      if (!Array.isArray(participantIds) || !participantIds.length) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "participantIds required" });
      }
      const result = await this.chatService.inviteToGroup(
        conversationId,
        req["authUser"]["_id"],
        participantIds
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public removeGroupMember = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { memberId } = req.body;
      if (!memberId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "memberId required" });
      }
      const result = await this.chatService.removeGroupMember(
        conversationId,
        req["authUser"]["_id"],
        memberId
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public exitGroup = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const result = await this.chatService.exitGroup(
        conversationId,
        req["authUser"]["_id"]
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public updateGroup = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { groupName, groupDescription, groupAvatar } = req.body;
      const result = await this.chatService.updateGroup(
        conversationId,
        req["authUser"]["_id"],
        { groupName, groupDescription, groupAvatar }
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public deleteGroup = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const result = await this.chatService.deleteGroup(
        conversationId,
        req["authUser"]["_id"]
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  // ─── Reactions / forward / pins / search / transcribe / TTL / receipts / schedule ───
  public reactToMessage = async (req: Request, res: Response) => {
    try {
      const { messageId, emoji } = req.body || {};
      if (!messageId || !emoji) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "messageId and emoji required" });
      }
      const r = await this.extras.toggleReaction(req["authUser"]["_id"], messageId, emoji);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public forwardMessage = async (req: Request, res: Response) => {
    try {
      const { messageId, targets } = req.body || {};
      if (!messageId || !Array.isArray(targets)) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "messageId and targets[] required" });
      }
      const r = await this.extras.forwardMessage(req["authUser"]["_id"], messageId, targets);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public pinMessage = async (req: Request, res: Response) => {
    try {
      const { messageId } = req.body || {};
      if (!messageId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "messageId required" });
      }
      const r = await this.extras.pinMessage(req["authUser"]["_id"], messageId);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public unpinMessage = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.body || {};
      if (!conversationId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "conversationId required" });
      }
      const r = await this.extras.unpinMessage(req["authUser"]["_id"], conversationId);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getPinnedMessage = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      if (!conversationId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "conversationId required" });
      }
      const r = await this.extras.getPinnedMessage(req["authUser"]["_id"], conversationId);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public searchAllMessages = async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "");
      const limit = Math.min(Number(req.query.limit) || 25, 50);
      const r = await this.extras.searchAllMessages(req["authUser"]["_id"], q, limit);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public transcribeVoiceMessage = async (req: Request, res: Response) => {
    try {
      const { messageId } = req.body || {};
      if (!messageId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "messageId required" });
      }
      const r = await this.extras.transcribeVoiceMessage(req["authUser"]["_id"], messageId);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public setDisappearingTtl = async (req: Request, res: Response) => {
    try {
      const { conversationId, minutes } = req.body || {};
      if (!conversationId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "conversationId required" });
      }
      const r = await this.extras.setDisappearingTtl(
        req["authUser"]["_id"],
        conversationId,
        Number(minutes)
      );
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public setReadReceiptsEnabled = async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body || {};
      const r = await this.extras.setReadReceiptsEnabled(
        req["authUser"]["_id"],
        !!enabled
      );
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public scheduleMessage = async (req: Request, res: Response) => {
    try {
      const r = await this.extras.scheduleMessage(req["authUser"]["_id"], req.body || {});
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public listScheduledMessages = async (req: Request, res: Response) => {
    try {
      const r = await this.extras.listScheduledMessages(req["authUser"]["_id"]);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public cancelScheduledMessage = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const r = await this.extras.cancelScheduledMessage(req["authUser"]["_id"], id);
      return res.status(r.code).send({ status: CONSTANCE.SUCCESS, data: r.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  public getOrCreateConversation = async (req: Request, res: Response) => {
    try {
      const participantId = req.body.otherUserId || req.body.participantId;
      if (!participantId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "otherUserId or participantId is required" });
      }
      const result = await this.chatService.getOrCreateConversation(
        req["authUser"]["_id"],
        participantId
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };
}
