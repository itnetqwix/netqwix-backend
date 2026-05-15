import booked_session from "../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";

export async function checkTrainerBookingConflict(
  trainer_id: string,
  start: Date,
  end: Date,
  excludeSessionId?: string
): Promise<string | null> {
  const filter: Record<string, unknown> = {
    trainer_id,
    status: { $nin: [BOOKED_SESSIONS_STATUS.cancel] },
    start_time: { $lt: end },
    end_time: { $gt: start },
  };
  if (excludeSessionId) {
    filter._id = { $ne: excludeSessionId };
  }
  const conflict = await booked_session.findOne(filter).lean();
  if (conflict) {
    return "This trainer already has a booking during this time slot. Please choose a different time.";
  }
  return null;
}
