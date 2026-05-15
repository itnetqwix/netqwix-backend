import { log } from "./../../../logger";
import { CONSTANCE, Message } from "./../../config/constance";
import { ResponseBuilder } from "./../../helpers/responseBuilder";
import { Request, Response } from "express";
import { AdminService } from "./adminService";
import CallDiagnostics from "../../model/call_diagnostics.schema";
import { AccountType } from "../auth/authEnum";

const adminErrorBody = (result: ResponseBuilder) => ({
  status: result.status,
  error: ResponseBuilder.stringifyError(result.error),
  code: result.code || CONSTANCE.RES_CODE.error.badRequest,
});

export class AdminController {
  public adminService = new AdminService();
  public logger = log.getLogger();

  public updateGlobalCommission = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.adminService.updateGlobalCommission(req.body, req["authUser"]);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json(adminErrorBody(result));
        }
      }
    } catch (err) {
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: ResponseBuilder.stringifyError(err.error) });
    }
  };

  public getGlobalCommission = async (req, res) => {
    try {
      const result: ResponseBuilder =  await this.adminService.getGlobalCommission();
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result);
      } else {
        res.status(result.code).json(adminErrorBody(result));
      }
    } catch (err) {
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: ResponseBuilder.stringifyError(err.error) });
    }
  };

  // Get call diagnostics for a specific session or user
  public getCallDiagnostics = async (req: Request, res: Response) => {
    try {
      const at = String(req["authUser"]?.account_type ?? "").trim().toLowerCase();
      if (at !== String(AccountType.ADMIN).toLowerCase()) {
        return res.status(403).json({ status: CONSTANCE.FAIL, error: "Only admin can access call diagnostics" });
      }
      const { sessionId, userId, eventType, from, to, limit = 100, skip = 0 } = req.query;

      const query: any = {};
      if (sessionId) query.sessionId = sessionId;
      if (userId) query.userId = userId;
      if (eventType) query.eventType = eventType;
      if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(String(from));
        if (to) query.createdAt.$lte = new Date(String(to));
      }

      const diagnostics = await CallDiagnostics.find(query)
        .populate("sessionId", "start_time end_time session_start_time session_end_time")
        .populate("userId", "fullname email")
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(skip));

      const total = await CallDiagnostics.countDocuments(query);

      return res.status(200).json({
        status: CONSTANCE.SUCCESS,
        data: {
          diagnostics,
          total,
          limit: Number(limit),
          skip: Number(skip),
        },
        code: CONSTANCE.RES_CODE.success,
      });
    } catch (err) {
      this.logger.error("Error fetching call diagnostics:", err);
      return res.status(500).json({
        status: CONSTANCE.FAIL,
        error: "Failed to fetch call diagnostics",
        code: CONSTANCE.RES_CODE.error.internalServerError,
      });
    }
  };

  // Get call quality summary for a session
  public getCallQualitySummary = async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "sessionId is required",
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }

      const qualityStats = await CallDiagnostics.find({
        sessionId,
        eventType: "CALL_QUALITY_STATS",
      })
        .select("qualityStats createdAt userId accountType role")
        .sort({ createdAt: -1 });

      if (qualityStats.length === 0) {
        return res.status(200).json({
          status: CONSTANCE.SUCCESS,
          data: {
            sessionId,
            message: "No quality stats found for this session",
            stats: [],
          },
          code: CONSTANCE.RES_CODE.success,
        });
      }

      // Calculate averages
      const avgOverall = qualityStats.reduce((sum, s) => sum + (s.qualityStats?.overallScore || 0), 0) / qualityStats.length;
      const avgAudio = qualityStats.reduce((sum, s) => sum + (s.qualityStats?.audioScore || 0), 0) / qualityStats.length;
      const avgVideo = qualityStats.reduce((sum, s) => sum + (s.qualityStats?.videoScore || 0), 0) / qualityStats.length;
      const avgRtt = qualityStats.reduce((sum, s) => sum + (s.qualityStats?.rtt || 0), 0) / qualityStats.length;
      const usingRelayCount = qualityStats.filter(s => s.qualityStats?.usingRelay).length;

      return res.status(200).json({
        status: CONSTANCE.SUCCESS,
        data: {
          sessionId,
          summary: {
            totalSamples: qualityStats.length,
            averageOverallScore: Math.round(avgOverall * 100) / 100,
            averageAudioScore: Math.round(avgAudio * 100) / 100,
            averageVideoScore: Math.round(avgVideo * 100) / 100,
            averageRtt: Math.round(avgRtt * 100) / 100,
            relayUsagePercentage: Math.round((usingRelayCount / qualityStats.length) * 100),
          },
          stats: qualityStats,
        },
        code: CONSTANCE.RES_CODE.success,
      });
    } catch (err) {
      this.logger.error("Error fetching call quality summary:", err);
      return res.status(500).json({
        status: CONSTANCE.FAIL,
        error: "Failed to fetch call quality summary",
        code: CONSTANCE.RES_CODE.error.internalServerError,
      });
    }
  };

  public getUser360 = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const includeRaw = String(req.query.include || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      const result: ResponseBuilder = await this.adminService.getUser360(req["authUser"], id, includeRaw);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getUserLessons = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result: ResponseBuilder = await this.adminService.getUserLessons(req["authUser"], id, req.query);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getUserReviews = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result: ResponseBuilder = await this.adminService.getUserReviews(req["authUser"], id, req.query);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getUserAssets = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result: ResponseBuilder = await this.adminService.getUserAssets(req["authUser"], id, req.query);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public deleteEntity = async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const mode = String(req.query.mode || "soft").toLowerCase() === "hard" ? "hard" : "soft";
      const reason = String(req.query.reason || "");
      const result: ResponseBuilder = await this.adminService.deleteEntity(
        req["authUser"],
        entityType,
        entityId,
        mode,
        reason
      );
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getAuditLogs = async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId ? String(req.query.userId) : undefined;
      const result: ResponseBuilder = await this.adminService.getAdminAuditLogs(req["authUser"], userId, req.query);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getUserTimeline = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result: ResponseBuilder = await this.adminService.getUserTimeline(req["authUser"], id, req.query);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getClipPlayUrl = async (req: Request, res: Response) => {
    try {
      const { clipId } = req.params;
      const result: ResponseBuilder = await this.adminService.getAdminClipPlayUrl(req["authUser"], clipId);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  public getDashboardMetrics = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder = await this.adminService.getDashboardMetrics(req["authUser"]);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };

  /** Trainers & trainees with an active Socket.IO connection (same source as ADMIN_ONLINE_USERS). */
  public getOnlineUsers = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder = await this.adminService.getOnlineUsers(req["authUser"]);
      if (result.status !== CONSTANCE.FAIL) {
        return res.status(result.code).json(result);
      }
      return res.status(result.code).json(adminErrorBody(result));
    } catch (err) {
      this.logger.error(err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Internal Server Error" });
    }
  };
}
