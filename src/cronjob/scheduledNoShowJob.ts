import booked_session from "../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";
import { refundSessionEscrow } from "../modules/wallet/instantLessonRefundService";

const SCHEDULED_JOIN_GRACE_MS = 15 * 60 * 1000;

/** Refund trainee when trainer confirmed but never joined (scheduled sessions). */
export async function processScheduledNoShowRefunds(): Promise<number> {
  const cutoff = new Date(Date.now() - SCHEDULED_JOIN_GRACE_MS);
  const sessions = await booked_session
    .find({
      is_instant: { $ne: true },
      status: BOOKED_SESSIONS_STATUS.confirm,
      start_time: { $lte: cutoff },
      both_joined_at: null,
      refund_status: { $nin: ["completed", "refunded"] },
    })
    .limit(30)
    .lean();

  let count = 0;
  for (const s of sessions) {
    const start = s.start_time ? new Date(s.start_time) : null;
    if (!start || start.getTime() + SCHEDULED_JOIN_GRACE_MS > Date.now()) {
      continue;
    }
    await booked_session.findByIdAndUpdate(s._id, {
      $set: {
        status: BOOKED_SESSIONS_STATUS.cancel,
        refund_reason: "no_show",
      },
    });
    const res = await refundSessionEscrow(String(s._id), "scheduled_trainer_no_show");
    if (res.refunded) count += 1;
  }
  return count;
}
