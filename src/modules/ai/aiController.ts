import { Request, Response } from "express";
import { AIBusinessService } from "./aiBusinessService";
import { CONSTANCE } from "../../config/constance";

export class AIController {
  private service = new AIBusinessService();

  public recommendTrainers = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getRecommendedTrainers(req["authUser"]);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] recommendTrainers error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public chatAssistant = async (req: Request, res: Response) => {
    try {
      const result = await this.service.chatWithAssistant(req["authUser"], req.body);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] chatAssistant error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public lessonSummary = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getLessonSummary(req["authUser"], req.params.sessionId);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] lessonSummary error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public tagClip = async (req: Request, res: Response) => {
    try {
      const result = await this.service.tagClip(req["authUser"], req.params.clipId);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] tagClip error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public enhanceProfile = async (req: Request, res: Response) => {
    try {
      const result = await this.service.enhanceProfile(req["authUser"]);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] enhanceProfile error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public applyEnhancedProfile = async (req: Request, res: Response) => {
    try {
      const result = await this.service.applyEnhancedProfile(req["authUser"], req.body);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] applyEnhancedProfile error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public smartSchedule = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getSmartSchedule(req["authUser"], req.params.trainerId);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] smartSchedule error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public reviewAnalysis = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getReviewAnalysis(req["authUser"]);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] reviewAnalysis error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public smartSearch = async (req: Request, res: Response) => {
    try {
      const result = await this.service.smartSearch(req["authUser"], req.query.q as string);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[AI] smartSearch error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };
}
