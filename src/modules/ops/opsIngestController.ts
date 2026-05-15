import { Request, Response } from "express";
import { CLIENT_ALLOWED_EVENT_TYPES, OPS_CATEGORIES, OPS_SEVERITIES } from "../../config/ops";
import { opsEventService } from "./opsEventService";

const ingestRate = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRate(userId: string): boolean {
  const now = Date.now();
  const row = ingestRate.get(userId);
  if (!row || now > row.resetAt) {
    ingestRate.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (row.count >= RATE_LIMIT) return false;
  row.count += 1;
  return true;
}

export class OpsIngestController {
  report = async (req: Request, res: Response) => {
    try {
      const userId = req["authUser"]?._id?.toString();
      if (!userId) {
        return res.status(401).send({ status: "ERROR", message: "Unauthorized" });
      }
      if (!checkRate(userId)) {
        return res.status(429).send({ status: "ERROR", message: "Rate limit exceeded" });
      }

      const {
        event_type,
        category,
        severity,
        session_id,
        booking_id,
        payload,
        correlation_id,
        title,
        summary,
        related_user_id,
        client,
      } = req.body || {};

      if (!event_type || !CLIENT_ALLOWED_EVENT_TYPES.has(String(event_type))) {
        return res.status(400).send({
          status: "ERROR",
          message: "Invalid or disallowed event_type",
        });
      }

      const cat = category && OPS_CATEGORIES.includes(category) ? category : "connection";
      const sev =
        severity && OPS_SEVERITIES.includes(severity) ? severity : "error";

      const result = await opsEventService.record({
        event_type: String(event_type),
        category: cat,
        severity: sev,
        user_id: userId,
        related_user_id,
        session_id: session_id || booking_id,
        booking_id,
        title: title || String(event_type).replace(/_/g, " "),
        summary,
        payload: { ...(payload || {}), client },
        source: "client",
        correlation_id,
        idempotency_key: correlation_id
          ? `${userId}:${event_type}:${correlation_id}`
          : undefined,
      });

      return res.status(200).send({
        status: "SUCCESS",
        data: { event_id: result.event.event_id, idempotent: result.idempotent },
      });
    } catch (e: any) {
      console.error("[OpsIngest] report", e);
      return res.status(500).send({ status: "ERROR", message: e?.message });
    }
  };
}

export const opsIngestController = new OpsIngestController();
