import { reconcilePaidUnappliedExtensions } from "../modules/trainee/sessionExtensionService";

/** Re-apply extension rows that were paid but not persisted to the session. */
export async function runExtensionReconcileJob(): Promise<void> {
  const result = await reconcilePaidUnappliedExtensions();

  const needsOpsAlert =
    result.errors > 0 ||
    (result.scanned > 0 && result.applied === 0 && result.refunded === 0);

  if (needsOpsAlert) {
    try {
      const { recordOpsEvent } = require("../modules/ops/opsEventService");
      void recordOpsEvent({
        category: "payment",
        severity: result.errors > 2 ? "error" : "warning",
        event_type: "EXTENSION_RECONCILE_ALERT",
        title: "Extension payment reconcile needs attention",
        summary: `scanned=${result.scanned} applied=${result.applied} errors=${result.errors} refunded=${result.refunded}`,
        payload: result,
        source: "server",
        idempotency_key: `extension-reconcile:${new Date().toISOString().slice(0, 13)}`,
      });
    } catch (err) {
      console.warn("[extensionReconcile] ops event failed", err);
    }
  }
}
