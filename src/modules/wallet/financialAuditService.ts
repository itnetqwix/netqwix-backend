import financial_audit_log from "../../model/financial_audit_log.schema";
import { recordOpsEvent } from "../ops/opsEventService";

export class FinancialAuditService {
  async log(params: {
    action: string;
    entity_type: string;
    entity_id?: string;
    user_id?: string;
    admin_id?: string;
    amount_minor?: number;
    currency?: string;
    reason?: string;
    meta?: Record<string, unknown>;
    idempotency_key?: string;
  }) {
    const doc = await financial_audit_log.create(params);

    const action = params.action || "";
    const severity = action.match(/fail|lock|insufficient/i)
      ? action.match(/lock/i)
        ? "warning"
        : "error"
      : "info";
    const category = action.match(/escrow|payment|refund|stripe/i)
      ? "payment"
      : "wallet";

    recordOpsEvent({
      category,
      severity,
      event_type: action,
      user_id: params.user_id,
      session_id: (params.meta?.session_id as string) || undefined,
      title: action.replace(/_/g, " "),
      summary: params.reason,
      payload: { ...params.meta, entity_type: params.entity_type, entity_id: params.entity_id },
      source: params.admin_id ? "admin" : "server",
      idempotency_key: params.idempotency_key
        ? `financial:${params.idempotency_key}`
        : `financial:${doc._id}`,
      source_ref: String(doc._id),
      source_collection: "financial_audit_log",
    });

    return doc;
  }
}

export const financialAuditService = new FinancialAuditService();
