import booked_session from "../model/booked_sessions.schema";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";

async function checkPartyBookingConflict(
  field: "trainer_id" | "trainee_id",
  userId: string,
  start: Date,
  end: Date,
  excludeSessionId?: string
): Promise<string | null> {
  const filter: Record<string, unknown> = {
    [field]: userId,
    status: { $nin: [BOOKED_SESSIONS_STATUS.cancel] },
    start_time: { $lt: end },
    end_time: { $gt: start },
  };
  if (excludeSessionId) {
    filter._id = { $ne: excludeSessionId };
  }
  const conflict = await booked_session.findOne(filter).lean();
  if (conflict) {
    return field === "trainer_id"
      ? "This trainer already has a booking during this time slot. Please choose a different time."
      : "You already have a session during this time. Please wait or choose another time.";
  }
  return null;
}

export async function checkTrainerBookingConflict(
  trainer_id: string,
  start: Date,
  end: Date,
  excludeSessionId?: string
): Promise<string | null> {
  return checkPartyBookingConflict("trainer_id", trainer_id, start, end, excludeSessionId);
}

export async function checkTraineeBookingConflict(
  trainee_id: string,
  start: Date,
  end: Date,
  excludeSessionId?: string
): Promise<string | null> {
  return checkPartyBookingConflict("trainee_id", trainee_id, start, end, excludeSessionId);
}

export async function checkBothPartiesBookingConflict(
  trainer_id: string,
  trainee_id: string,
  start: Date,
  end: Date,
  excludeSessionId?: string
): Promise<string | null> {
  const trainerMsg = await checkTrainerBookingConflict(
    trainer_id,
    start,
    end,
    excludeSessionId
  );
  if (trainerMsg) return trainerMsg;
  return checkTraineeBookingConflict(trainee_id, start, end, excludeSessionId);
}
