import * as crypto from "crypto";
import mongoose from "mongoose";
import ops_events from "../../model/ops_events.schema";
import type { OpsCategory, OpsSeverity } from "../../config/ops";

export type SuggestedAction = {
  action: string;
  label: string;
  href?: string;
  api?: string;
};

export type RecordOpsEventInput = {
  category: OpsCategory | string;
  severity?: OpsSeverity | string;
  event_type: string;
  user_id?: string | mongoose.Types.ObjectId | null;
  related_user_id?: string | mongoose.Types.ObjectId | null;
  session_id?: string | mongoose.Types.ObjectId | null;
  booking_id?: string | mongoose.Types.ObjectId | null;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
  source?: "client" | "server" | "admin" | "webhook";
  correlation_id?: string;
  idempotency_key?: string;
  suggested_actions?: SuggestedAction[];
  source_ref?: string;
  source_collection?: string;
  resolution_status?: string;
};

function buildDefaultActions(input: RecordOpsEventInput): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const uid = input.user_id ? String(input.user_id) : null;
  const sid = input.session_id ? String(input.session_id) : null;

  if (uid) {
    actions.push({
      action: "open_user_360",
      label: "Open User 360",
      href: `/apps/users/${uid}`,
    });
  }
  if (sid) {
    actions.push({
      action: "open_booking",
      label: "Open booking",
      href: `/apps/booking?sessionId=${sid}`,
    });
    actions.push({
      action: "call_diagnostics",
      label: "Call diagnostics",
      href: `/apps/call-diagnostics?sessionId=${sid}`,
    });
  }
  if (
    input.category === "payment" ||
    input.category === "wallet" ||
    input.event_type?.includes("REFUND")
  ) {
    actions.push({
      action: "finance",
      label: "Finance / escrow",
      href: "/apps/finance",
    });
  }
  if (input.category === "support") {
    actions.push({
      action: "support_tickets",
      label: "Support tickets",
      href: "/apps/concern-by-user",
    });
  }
  return actions;
}

export class OpsEventService {
  async record(input: RecordOpsEventInput) {
    if (input.idempotency_key) {
      const existing = await ops_events.findOne({ idempotency_key: input.idempotency_key }).lean();
      if (existing) return { event: existing, idempotent: true };
    }

    const suggested =
      input.suggested_actions?.length > 0
        ? input.suggested_actions
        : buildDefaultActions(input);

    const doc = await ops_events.create({
      event_id: crypto.randomUUID(),
      idempotency_key: input.idempotency_key,
      category: input.category,
      severity: input.severity || "info",
      event_type: input.event_type,
      user_id: input.user_id ? new mongoose.Types.ObjectId(String(input.user_id)) : undefined,
      related_user_id: input.related_user_id
        ? new mongoose.Types.ObjectId(String(input.related_user_id))
        : undefined,
      session_id: input.session_id
        ? new mongoose.Types.ObjectId(String(input.session_id))
        : undefined,
      booking_id: input.booking_id
        ? new mongoose.Types.ObjectId(String(input.booking_id))
        : input.session_id
          ? new mongoose.Types.ObjectId(String(input.session_id))
          : undefined,
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      source: input.source || "server",
      correlation_id: input.correlation_id,
      resolution_status: input.resolution_status || "open",
      suggested_actions: suggested,
      source_ref: input.source_ref,
      source_collection: input.source_collection,
    });

    return { event: doc.toObject(), idempotent: false };
  }

  buildQuery(filters: Record<string, unknown>) {
    const q: Record<string, unknown> = {};

    if (filters.userId && mongoose.isValidObjectId(String(filters.userId))) {
      const uid = new mongoose.Types.ObjectId(String(filters.userId));
      q.$or = [{ user_id: uid }, { related_user_id: uid }];
    }
    if (filters.sessionId && mongoose.isValidObjectId(String(filters.sessionId))) {
      q.session_id = new mongoose.Types.ObjectId(String(filters.sessionId));
    }
    if (filters.category) {
      const cats = String(filters.category)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cats.length === 1) q.category = cats[0];
      else if (cats.length > 1) q.category = { $in: cats };
    }
    if (filters.severity) {
      const sev = String(filters.severity)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (sev.length === 1) q.severity = sev[0];
      else if (sev.length > 1) q.severity = { $in: sev };
    }
    if (filters.resolution_status) {
      q.resolution_status = filters.resolution_status;
    }
    if (filters.event_type) {
      q.event_type = new RegExp(String(filters.event_type), "i");
    }
    if (filters.instant_only === "true" || filters.instant_only === true) {
      q.category = "instant_lesson";
    }
    if (filters.refund_related === "true" || filters.refund_related === true) {
      q.$or = [
        { category: "payment" },
        { category: "wallet" },
        { event_type: /refund/i },
        { title: /refund/i },
      ];
    }
    if (filters.search) {
      const s = String(filters.search).trim();
      q.$text = { $search: s };
    }
    if (filters.from || filters.to) {
      q.createdAt = {};
      if (filters.from) (q.createdAt as any).$gte = new Date(String(filters.from));
      if (filters.to) (q.createdAt as any).$lte = new Date(String(filters.to));
    }

    return q;
  }

  async list(filters: Record<string, unknown> = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
    const q = this.buildQuery(filters);

    const [items, total] = await Promise.all([
      ops_events
        .find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user_id", "fullname email account_type")
        .populate("related_user_id", "fullname email")
        .lean(),
      ops_events.countDocuments(q),
    ]);

    return { items, total, page, limit };
  }

  async getById(eventId: string) {
    if (mongoose.isValidObjectId(eventId)) {
      return ops_events
        .findById(eventId)
        .populate("user_id", "fullname email account_type mobile_no")
        .populate("related_user_id", "fullname email")
        .populate("resolved_by", "fullname email")
        .lean();
    }
    return ops_events
      .findOne({ event_id: eventId })
      .populate("user_id", "fullname email account_type mobile_no")
      .populate("related_user_id", "fullname email")
      .populate("resolved_by", "fullname email")
      .lean();
  }

  async listBySession(sessionId: string, limit = 50) {
    if (!mongoose.isValidObjectId(sessionId)) return [];
    return ops_events
      .find({ session_id: sessionId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async resolve(
    eventId: string,
    adminId: string,
    body: { resolution_status?: string; resolution_note?: string }
  ) {
    const filter = mongoose.isValidObjectId(eventId)
      ? { _id: eventId }
      : { event_id: eventId };
    return ops_events
      .findOneAndUpdate(
        filter,
        {
          $set: {
            resolution_status: body.resolution_status || "resolved",
            resolution_note: body.resolution_note,
            resolved_by: new mongoose.Types.ObjectId(adminId),
            resolved_at: new Date(),
          },
        },
        { new: true }
      )
      .lean();
  }
}

export const opsEventService = new OpsEventService();

/** Fire-and-forget helper for use across the codebase. */
export function recordOpsEvent(input: RecordOpsEventInput): void {
  void opsEventService.record(input).catch((err) => {
    console.error("[OpsEventService] record failed", input.event_type, err?.message);
  });
}
