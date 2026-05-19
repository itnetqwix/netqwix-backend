import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { storageService } from "./storageService";

export class StorageController {
  getStorage = async (req: Request, res: Response) => {
    try {
      const result = await storageService.getStorage(req["authUser"]["_id"]);
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };

  createCheckout = async (req: Request, res: Response) => {
    try {
      const { planId, interval } = req.body;
      const result = await storageService.createCheckout(
        req["authUser"]["_id"],
        planId,
        interval ?? "monthly"
      );
      return res.status(result.code).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: "Internal server error" });
    }
  };
}

export const storageController = new StorageController();
