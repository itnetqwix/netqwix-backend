import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { assertAdminUser } from "../admin/adminPermission";
import { referralAdminService } from "./referralAdminService";

export class ReferralAdminController {
  public getDashboard = async (req: Request, res: Response) => {
    try {
      const denied = assertAdminUser(req["authUser"]);
      if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
      const result = await referralAdminService.getDashboard();
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public listRewards = async (req: Request, res: Response) => {
    try {
      const denied = assertAdminUser(req["authUser"]);
      if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const result = await referralAdminService.listRewards(page, limit, status);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public listAttributions = async (req: Request, res: Response) => {
    try {
      const denied = assertAdminUser(req["authUser"]);
      if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const result = await referralAdminService.listAttributions(page, limit);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };
}

export const referralAdminController = new ReferralAdminController();
