import mongoose from "mongoose";
import booked_session from "../model/booked_sessions.schema";

export type SessionAccessFail = { ok: false; code: number; error: string };
export type SessionAccessOk = {
  ok: true;
  booking: {
    trainer_id: unknown;
    trainee_id: unknown;
    is_instant?: boolean;
    status?: string;
  };
  isTrainer: boolean;
  isTrainee: boolean;
};

export async function assertSessionParticipant(
  userId: string,
  sessionId: string,
  roles?: Array<"trainer" | "trainee">
): Promise<SessionAccessOk | SessionAccessFail> {
  if (!mongoose.isValidObjectId(sessionId)) {
    return { ok: false as const, code: 400, error: "Invalid session id." };
  }
  const booking = await booked_session
    .findById(sessionId)
    .select("trainer_id trainee_id is_instant status")
    .lean();
  if (!booking) {
    return { ok: false as const, code: 404, error: "Session not found." };
  }
  const isTrainer = String(booking.trainer_id) === String(userId);
  const isTrainee = String(booking.trainee_id) === String(userId);
  if (!isTrainer && !isTrainee) {
    return { ok: false as const, code: 403, error: "Not a participant on this session." };
  }
  if (roles?.includes("trainer") && !isTrainer) {
    return { ok: false as const, code: 403, error: "Trainer only." };
  }
  if (roles?.includes("trainee") && !isTrainee) {
    return { ok: false as const, code: 403, error: "Trainee only." };
  }
  return {
    ok: true as const,
    booking: {
      trainer_id: booking.trainer_id,
      trainee_id: booking.trainee_id,
      is_instant: booking.is_instant,
      status: booking.status,
    },
    isTrainer,
    isTrainee,
  };
}

export async function assertTrainerOwnsSession(
  trainerId: string,
  sessionId: string,
  traineeId?: string
): Promise<SessionAccessOk | SessionAccessFail> {
  const access = await assertSessionParticipant(trainerId, sessionId, ["trainer"]);
  if (access.ok === false) return access;
  if (traineeId && String(access.booking.trainee_id) !== String(traineeId)) {
    return { ok: false as const, code: 400, error: "Trainee does not match this session." };
  }
  return access;
}

export function computeScheduledDurationMinutes(
  sessionStart: string,
  sessionEnd: string
): number {
  const [sh, sm] = String(sessionStart).split(":").map(Number);
  const [eh, em] = String(sessionEnd).split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}
