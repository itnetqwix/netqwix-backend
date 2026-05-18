import booked_session from "../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";
import { INSTANT_PHASE } from "../config/instantLesson";
import { runInstantLessonExpire } from "../modules/socket/socket.service";

/** Recover expired instant phases after server restart (in-memory timers lost). */
export async function recoverExpiredInstantLessons(): Promise<number> {
  const now = new Date();
  let count = 0;

  const acceptExpired = await booked_session
    .find({
      is_instant: true,
      status: BOOKED_SESSIONS_STATUS.BOOKED,
      instant_phase: INSTANT_PHASE.PENDING_ACCEPT,
      accept_deadline_at: { $lte: now },
    })
    .limit(30)
    .lean();

  for (const b of acceptExpired) {
    await runInstantLessonExpire(
      String(b._id),
      String(b.trainer_id),
      String(b.trainee_id),
      undefined,
      "accept"
    );
    count += 1;
  }

  const joinExpired = await booked_session
    .find({
      is_instant: true,
      status: BOOKED_SESSIONS_STATUS.confirm,
      instant_phase: INSTANT_PHASE.PENDING_JOIN,
      join_deadline_at: { $lte: now },
      both_joined_at: null,
    })
    .limit(30)
    .lean();

  for (const b of joinExpired) {
    await runInstantLessonExpire(
      String(b._id),
      String(b.trainer_id),
      String(b.trainee_id),
      undefined,
      "join"
    );
    count += 1;
  }

  return count;
}
