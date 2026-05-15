import { Request, Response } from "express";
import { trainerReviewService } from "./trainerReviewService";

export class TrainerReviewAdminController {
  list = async (req: Request, res: Response) => {
    try {
      const data = await trainerReviewService.list(req.query as Record<string, unknown>);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e.message });
    }
  };

  detail = async (req: Request, res: Response) => {
    try {
      const data = await trainerReviewService.getDetail(req.params.userId);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(404).send({ status: "ERROR", message: e.message });
    }
  };

  approve = async (req: Request, res: Response) => {
    try {
      const adminId = req["authUser"]?._id?.toString();
      const data = await trainerReviewService.approve(req.params.userId, adminId);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  reject = async (req: Request, res: Response) => {
    try {
      const adminId = req["authUser"]?._id?.toString();
      const data = await trainerReviewService.reject(
        req.params.userId,
        adminId,
        req.body?.reason || ""
      );
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(400).send({ status: "ERROR", message: e.message });
    }
  };

  migrate = async (req: Request, res: Response) => {
    try {
      const dryRun = req.body?.dry_run !== false;
      const data = await trainerReviewService.runMigration(dryRun);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e.message });
    }
  };

  pendingCount = async (_req: Request, res: Response) => {
    try {
      const data = await trainerReviewService.list({ limit: 1 });
      return res.status(200).send({ status: "SUCCESS", data: { total: data.total } });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e.message });
    }
  };
}

export const trainerReviewAdminController = new TrainerReviewAdminController();
