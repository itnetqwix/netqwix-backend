import { Request, Response } from "express";
import { ChatService } from "./chatService";
import { CONSTANCE } from "../../config/constance";

export class ChatController {
  private chatService = new ChatService();

  public getConversations = async (req: Request, res: Response) => {
    try {
      const result = await this.chatService.getConversations(
        req["authUser"]["_id"]
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
      const { receiverId, content, type, mediaUrl } = req.body;
      if (!receiverId) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "receiverId is required" });
      }
      if (!content && type === "text") {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "content is required for text messages" });
      }
      const result = await this.chatService.sendMessage(
        req["authUser"]["_id"],
        receiverId,
        content,
        type || "text",
        mediaUrl
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
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
