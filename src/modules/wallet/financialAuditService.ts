import financial_audit_log from "../../model/financial_audit_log.schema";

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
    return financial_audit_log.create(params);
  }
}

export const financialAuditService = new FinancialAuditService();
