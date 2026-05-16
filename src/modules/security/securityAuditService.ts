import { log } from "../../logger";

export type SecurityAuditEntry = {
  action: string;
  userId?: string;
  ip?: string;
  path?: string;
  meta?: Record<string, unknown>;
};

export function logSecurityEvent(entry: SecurityAuditEntry) {
  log.getLogger().warn(
    JSON.stringify({
      type: "security_audit",
      at: new Date().toISOString(),
      ...entry,
    })
  );
}
