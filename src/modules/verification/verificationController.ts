import { Request, Response } from "express";
import { otpService } from "./otpService";
import { onboardingService } from "./onboardingService";

export class VerificationController {
  status = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const data = await onboardingService.getStatus(userId);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  sendOtp = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const channel = req.body?.channel;
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).send({ status: "ERROR", message: "Invalid channel" });
      }
      const data = await otpService.sendOtp(userId, channel);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  verifyOtp = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const { channel, code } = req.body || {};
      const data = await otpService.verifyOtp(userId, channel, String(code || ""));
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  updateProfile = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const data = await onboardingService.updateProfile(userId, req.body || {});
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  createFaceSession = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const data = await onboardingService.createFaceSession(userId);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  completeFace = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      const data = await onboardingService.completeFaceSession(userId, req.body?.sessionId);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };
}

export const verificationController = new VerificationController();
