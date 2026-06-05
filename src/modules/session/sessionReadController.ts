/**
 * Session read APIs — delegates to session services; userController forwards here.
 */

import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { Message } from "../../enum/message.enum";
import { sessionDetailService } from "./sessionDetailService";

export class SessionReadController {
  getSessionDetail = async (req: Request, res: Response) => {
    try {
      if (!(req as any).authUser) return;
      const userId = String((req as any).authUser?._id);
      const accountType = (req as any).authUser?.account_type;
      const bookingId = String(req.params.bookingId);
      const detail = await sessionDetailService.getSessionDetailForUser(
        bookingId,
        userId,
        accountType
      );
      if (!detail) {
        return res.status(404).json({ success: 0, message: "Session not found." });
      }
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ status: CONSTANCE.SUCCESS, data: detail });
    } catch {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  getSessionJoinReadiness = async (req: Request, res: Response) => {
    try {
      if (!(req as any).authUser) return;
      const userId = String((req as any).authUser?._id);
      const accountType = (req as any).authUser?.account_type;
      const bookingId = String(req.params.bookingId);
      const { getSessionJoinReadiness } = require("./sessionJoinReadinessService");
      const h = req.headers ?? {};
      const { parseLessonClientKindFromHeaders } = require("../../helpers/lesson/lessonClientTelemetry");
      const readiness = await getSessionJoinReadiness(bookingId, userId, accountType, {
        authSessionId:
          (h["x-nq-auth-session-id"] as string | undefined) ??
          (h["x-nq-session-id"] as string | undefined) ??
          (h["x-auth-session-id"] as string | undefined),
        deviceId:
          (h["x-nq-device-id"] as string | undefined) ??
          (h["x-device-id"] as string | undefined),
        viewerClientKind: parseLessonClientKindFromHeaders(h),
      });
      if (!readiness) {
        return res.status(404).json({ success: 0, message: "Session not found." });
      }
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ status: CONSTANCE.SUCCESS, data: readiness });
    } catch {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  getSessionTimeline = async (req: Request, res: Response) => {
    try {
      if (!(req as any).authUser) return;
      const userId = String((req as any).authUser?._id);
      const bookingId = String(req.params.bookingId);
      const { getSessionTimeline } = require("./sessionTimelineService");
      const result = await getSessionTimeline(bookingId, userId);
      if (!result.ok) {
        return res.status(result.code).json({
          success: 0,
          message: result.error,
        });
      }
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ status: CONSTANCE.SUCCESS, data: result.timeline });
    } catch {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };
}

export const sessionReadController = new SessionReadController();
