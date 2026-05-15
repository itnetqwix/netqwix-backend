import mongoose from "mongoose";
import ops_events from "../../model/ops_events.schema";
import admin_audit from "../../model/admin_audit.schema";
import financial_audit_log from "../../model/financial_audit_log.schema";
import raise_concern from "../../model/raise_concern.schema";
import write_us from "../../model/write_us.schema";
import call_diagnostics from "../../model/call_diagnostics.schema";
import { opsEventService } from "./opsEventService";

export class OpsBackfillService {
  async run(opts: { limit?: number; sources?: string[] } = {}) {
    const limit = Math.min(5000, opts.limit || 500);
    const sources = opts.sources || ["admin_audit", "financial_audit_log", "raise_concern", "call_diagnostics"];
    const counts: Record<string, number> = {};

    if (sources.includes("admin_audit")) {
      counts.admin_audit = await this.backfillAdminAudit(limit);
    }
    if (sources.includes("financial_audit_log")) {
      counts.financial_audit_log = await this.backfillFinancialAudit(limit);
    }
    if (sources.includes("raise_concern")) {
      counts.raise_concern = await this.backfillConcerns(limit);
    }
    if (sources.includes("call_diagnostics")) {
      counts.call_diagnostics = await this.backfillCallDiagnostics(limit);
    }

    return { counts };
  }

  private async backfillAdminAudit(limit: number) {
    const rows = await admin_audit.find().sort({ createdAt: -1 }).limit(limit).lean();
    let n = 0;
    for (const row of rows) {
      const key = `backfill:admin_audit:${row._id}`;
      const exists = await ops_events.findOne({ idempotency_key: key }).lean();
      if (exists) continue;
      await opsEventService.record({
        category: "admin",
        severity: "info",
        event_type: row.action || "ADMIN_ACTION",
        user_id: row.target_user_id || row.admin_id,
        title: row.action || "Admin action",
        summary: row.reason || (row.meta ? JSON.stringify(row.meta).slice(0, 500) : undefined),
        payload: row.meta,
        source: "admin",
        idempotency_key: key,
        source_ref: String(row._id),
        source_collection: "admin_audit",
      });
      n++;
    }
    return n;
  }

  private async backfillFinancialAudit(limit: number) {
    const rows = await financial_audit_log.find().sort({ createdAt: -1 }).limit(limit).lean();
    let n = 0;
    for (const row of rows) {
      const key = `backfill:financial_audit_log:${row._id}`;
      const exists = await ops_events.findOne({ idempotency_key: key }).lean();
      if (exists) continue;
      const severity =
        row.action?.includes("fail") || row.action?.includes("FAIL")
          ? "error"
          : row.action?.includes("lock")
            ? "warning"
            : "info";
      await opsEventService.record({
        category: row.action?.includes("escrow") ? "payment" : "wallet",
        severity,
        event_type: row.action || "FINANCIAL_AUDIT",
        user_id: row.user_id,
        session_id: row.meta?.session_id as string | undefined,
        title: row.action || "Financial event",
        summary: row.reason,
        payload: row.meta,
        source: "server",
        idempotency_key: key,
        source_ref: String(row._id),
        source_collection: "financial_audit_log",
      });
      n++;
    }
    return n;
  }

  private async backfillConcerns(limit: number) {
    let n = 0;
    const concerns = await raise_concern.find().sort({ createdAt: -1 }).limit(limit).lean();
    for (const row of concerns) {
      const key = `backfill:raise_concern:${row._id}`;
      if (await ops_events.findOne({ idempotency_key: key }).lean()) continue;
      await opsEventService.record({
        category: "support",
        severity: "warning",
        event_type: "SUPPORT_TICKET_CREATED",
        user_id: row.user_id,
        title: `Support concern: ${row.subject || row.reason || "Ticket"}`,
        summary: row.description?.slice?.(0, 300),
        booking_id: row.booking_id,
        payload: row,
        source: "server",
        idempotency_key: key,
        source_ref: String(row._id),
        source_collection: "raise_concern",
        suggested_actions: [
          { action: "view_ticket", label: "View tickets", href: "/apps/concern-by-user" },
        ],
      });
      n++;
    }
    const writes = await write_us.find().sort({ createdAt: -1 }).limit(limit).lean();
    for (const row of writes) {
      const key = `backfill:write_us:${row._id}`;
      if (await ops_events.findOne({ idempotency_key: key }).lean()) continue;
      await opsEventService.record({
        category: "support",
        severity: "info",
        event_type: "WRITE_US_CREATED",
        user_id: row.user_id,
        title: `Write us: ${row.subject || "Message"}`,
        summary: row.message?.slice?.(0, 300),
        payload: row,
        source: "server",
        idempotency_key: key,
        source_ref: String(row._id),
        source_collection: "write_us",
      });
      n++;
    }
    return n;
  }

  private async backfillCallDiagnostics(limit: number) {
    const rows = await call_diagnostics
      .find({
        $or: [
          { eventType: "CLIENT_PRECALL_CHECK", "preflightCheck.passed": false },
          { eventType: /fail|error/i },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    let n = 0;
    for (const row of rows) {
      const key = `backfill:call_diagnostics:${row._id}`;
      if (await ops_events.findOne({ idempotency_key: key }).lean()) continue;
      const failedPrecall =
        row.eventType === "CLIENT_PRECALL_CHECK" && row.preflightCheck?.passed === false;
      await opsEventService.record({
        category: failedPrecall ? "connection" : "call",
        severity: failedPrecall ? "error" : "warning",
        event_type: failedPrecall ? "CLIENT_PRECALL_FAILED" : row.eventType || "CALL_DIAGNOSTIC",
        user_id: row.userId,
        session_id: row.sessionId,
        title: `Call: ${row.eventType || "diagnostic"}`,
        summary: row.preflightCheck?.reason || undefined,
        payload: row,
        source: row.source === "client" ? "client" : "server",
        idempotency_key: key,
        source_ref: String(row._id),
        source_collection: "call_diagnostics",
      });
      n++;
    }
    return n;
  }

  async dashboardStats() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [criticalOpen, instantFailures, callPreflightFailures] = await Promise.all([
      ops_events.countDocuments({
        severity: "critical",
        resolution_status: { $in: ["open", "investigating"] },
        createdAt: { $gte: since },
      }),
      ops_events.countDocuments({
        category: "instant_lesson",
        severity: { $in: ["error", "critical"] },
        createdAt: { $gte: since },
      }),
      ops_events.countDocuments({
        event_type: { $in: ["CLIENT_PRECALL_FAILED", "CLIENT_CALL_ERROR"] },
        createdAt: { $gte: since },
      }),
    ]);
    return { criticalOpen, instantFailures, callPreflightFailures, since };
  }
}

export const opsBackfillService = new OpsBackfillService();
