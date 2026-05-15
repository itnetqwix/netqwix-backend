import { Request, Response } from "express";
import { opsEventService } from "./opsEventService";
import { opsBackfillService } from "./opsBackfillService";
import { OPS_RESOLUTION_PLAYBOOK } from "./opsPlaybook";

export class OpsAdminController {
  list = async (req: Request, res: Response) => {
    try {
      const data = await opsEventService.list(req.query as Record<string, unknown>);
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  listByUser = async (req: Request, res: Response) => {
    try {
      const data = await opsEventService.list({
        ...req.query,
        userId: req.params.userId,
      });
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  listBySession = async (req: Request, res: Response) => {
    try {
      const items = await opsEventService.listBySession(req.params.sessionId);
      return res.status(200).send({ status: "SUCCESS", data: { items } });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  detail = async (req: Request, res: Response) => {
    try {
      const event = await opsEventService.getById(req.params.eventId);
      if (!event) {
        return res.status(404).send({ status: "ERROR", message: "Event not found" });
      }
      const related = event.session_id
        ? await opsEventService.listBySession(String(event.session_id), 30)
        : [];
      const playbook = OPS_RESOLUTION_PLAYBOOK[event.event_type] || null;
      return res.status(200).send({
        status: "SUCCESS",
        data: { event, related, playbook },
      });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  resolve = async (req: Request, res: Response) => {
    try {
      const adminId = req["authUser"]?._id?.toString();
      if (!adminId) {
        return res.status(401).send({ status: "ERROR", message: "Unauthorized" });
      }
      const updated = await opsEventService.resolve(req.params.eventId, adminId, req.body);
      if (!updated) {
        return res.status(404).send({ status: "ERROR", message: "Event not found" });
      }
      return res.status(200).send({ status: "SUCCESS", data: updated });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  backfill = async (req: Request, res: Response) => {
    try {
      const result = await opsBackfillService.run(req.body || {});
      return res.status(200).send({ status: "SUCCESS", data: result });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  stats = async (req: Request, res: Response) => {
    try {
      const data = await opsBackfillService.dashboardStats();
      return res.status(200).send({ status: "SUCCESS", data });
    } catch (e: any) {
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };

  playbook = async (_req: Request, res: Response) => {
    return res.status(200).send({ status: "SUCCESS", data: OPS_RESOLUTION_PLAYBOOK });
  };
}

export const opsAdminController = new OpsAdminController();
