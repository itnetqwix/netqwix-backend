import { Request, Response } from "express";
import { BroadcastService } from "./broadcastService";
import { CONSTANCE } from "../../config/constance";

export class BroadcastController {
  private service = new BroadcastService();

  public create = async (req: Request, res: Response) => {
    try {
      const result = await this.service.createAndSend(req.body, req["authUser"]);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] create error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public list = async (req: Request, res: Response) => {
    try {
      const result = await this.service.listBroadcasts(req["authUser"], req.query);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] list error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public getById = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getBroadcastById(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] getById error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public resend = async (req: Request, res: Response) => {
    try {
      const result = await this.service.resendBroadcast(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] resend error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public remove = async (req: Request, res: Response) => {
    try {
      const result = await this.service.deleteBroadcast(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] delete error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public previewCount = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getRecipientCount(req["authUser"], req.query);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[Broadcast] previewCount error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };
}
