import booked_session from "../../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { refundSessionEscrow } from "./instantLessonRefundService";

/**
 * Reconcile sessions with failed refund transfers or stuck pending refunds (SLA cron).
 */
export async function reconcileFailedRefundTransfers(): Promise<number> {
  const rows = await booked_session
    .find({
      status: BOOKED_SESSIONS_STATUS.cancel,
      refund_reason: { $exists: true, $ne: null },
      $or: [
        { refund_status: "failed" },
        { "refund_transfer.status": "failed" },
        {
          refund_status: { $nin: ["completed", "refunded"] },
          refund_reason: { $exists: true },
        },
      ],
    })
    .limit(50)
    .lean();

  let count = 0;
  for (const b of rows) {
    const res = await refundSessionEscrow(
      String(b._id),
      String(b.refund_reason || "reconcile_retry")
    );
    if (res.refunded) count += 1;
  }
  return count;
}
