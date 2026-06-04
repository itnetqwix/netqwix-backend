import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { pointsService } from "./pointsService";

export class PointsController {
  balance = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).json({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await pointsService.getBalance(String(authUser._id));
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).json({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  catalog = async (_req: Request, res: Response) => {
    try {
      const result = pointsService.getCatalog();
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).json({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  ledger = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).json({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await pointsService.listLedger(String(authUser._id), req.query);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).json({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  redeem = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).json({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await pointsService.redeemPoints(String(authUser._id), req.body);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).json({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };
}

export const pointsController = new PointsController();
