import { Request, Response } from "express";
import { log } from "../../../logger";
import { commonService } from "./commonService";
import { CONSTANCE } from "../../config/constance";
import booked_session from "../../model/booked_sessions.schema";

export class commonController {
  public logger = log.getLogger();
  public commonService = new commonService();

  public uploads = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.uploadFile(req, res);
      return response;
      // res.status(CONSTANCE.RES_CODE.success).json(response)
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code
        ? error.code
        : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";

      return res
        .status(statusCode)
        .json({ status: "error", message: errorMessage });
    }
  };

  public videoUploadUrl = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.videoUploadUrl(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public profileImageUrl = async (req: Request, res: Response) => {
    try {
      if (req["authUser"]) {
        const response = await this.commonService.profileImageUrl(req, res);
        return response;
      }
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public generateThumbnail = async (req: Request, res: Response) => {
    try {
      if (req["authUser"]) {
        const response = await this.commonService.generateThumbnail(req, res);
        return response;
      }
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public sessionsVideoUploadUrl = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.sessionsVideoUploadUrl(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };
  public getAllSavedSession = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.getAllSavedSession(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public pdfUploadUrl = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.pdfUploadUrl(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public getClips = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.getClips(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public traineeClips = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.traineeClips(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public deleteClip = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.deleteClip(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };
  public deleteSavedSession = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.deleteSavedSession(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public featuredContentUploadUrl = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.featuredContentUploadUrl(req, res);
      return response;
    } catch(error) {
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({status: "error", message: errorMessage});
    }
  };

  public chatMediaUploadUrl = async (req: Request, res: Response) => {
    try {
      const response = await this.commonService.chatMediaUploadUrl(req, res);
      return response;
    } catch (error) {
      this.logger.error(error);
      const statusCode = error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError;
      const errorMessage = error.message || "Internal Server Error";
      return res.status(statusCode).json({ status: "error", message: errorMessage });
    }
  };

  public addExtendedSessionEndTime = async (req: Request, res: Response) => {
    try {
        const { sessionId, extendedEndTime,extended_session_end_time } = req.body;

        if (!sessionId || !extendedEndTime || !extended_session_end_time) {
            return res.status(400).json({
                success: false,
                message: "Session ID and extended end time are required"
            });
        }

        const existing = await booked_session.findById(sessionId).select("is_instant").lean();
        if (existing?.is_instant) {
            return res.status(403).json({
                success: false,
                message:
                    "Instant lessons must use paid in-session extension. Call POST /trainee/session-extension/confirm instead.",
            });
        }

        const updatedSession = await booked_session.findByIdAndUpdate(
            sessionId,
            { extended_session_end_time,extended_end_time:extendedEndTime },
            { new: true }
        );

        if (!updatedSession) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: updatedSession,
            message: "Session end time extended successfully"
        });

    } catch (error) {
        console.error("Error extending session time:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};
}