import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import Report from "../../model/report.schema";
import {
  clearLessonLiveState,
  drainLiveNotesForPersist,
  type LiveNoteEntry,
} from "./lessonLiveStateStore";
import { clearLessonClientTelemetry } from "../../helpers/lesson/lessonClientTelemetry";

export type SessionHandoffSummary = {
  sessionId: string;
  status: string;
  duration_minutes: number | null;
  total_extended_minutes: number;
  clips_reviewed_count: number;
  live_notes_count: number;
  shared_notes: Array<{
    text: string;
    elapsed_seconds: number;
  }>;
  can_rate: boolean;
  can_rebook: boolean;
  game_plan_status: "none" | "pending" | "available";
  game_plan_title: string | null;
  game_plan_expected_by: string | null;
  game_plan_updated_at: string | null;
  peer: {
    _id: string;
    fullname: string | null;
    role: "trainer" | "trainee";
  } | null;
  ended_at: string | null;
};

async function loadBooking(bookingId: string) {
  if (!mongoose.isValidObjectId(bookingId)) return null;
  const rows = await booked_session.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(bookingId) } },
    {
      $lookup: {
        from: "users",
        localField: "trainer_id",
        foreignField: "_id",
        as: "trainer_info",
        pipeline: [{ $project: { _id: 1, fullname: 1 } }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "trainee_id",
        foreignField: "_id",
        as: "trainee_info",
        pipeline: [{ $project: { _id: 1, fullname: 1 } }],
      },
    },
    {
      $addFields: {
        trainer_info: { $arrayElemAt: ["$trainer_info", 0] },
        trainee_info: { $arrayElemAt: ["$trainee_info", 0] },
      },
    },
  ]);
  return rows[0] ?? null;
}

/** Persist drained live notes + cached handoff summary when a lesson ends. */
export async function persistLessonLiveStateOnEnd(sessionId: string): Promise<void> {
  const sid = String(sessionId);
  const notes = drainLiveNotesForPersist(sid);
  if (!notes.length) {
    clearLessonLiveState(sid);
    await clearLessonClientTelemetry(sid);
    return;
  }

  const mongoNotes = notes.map((n) => ({
    text: n.text,
    author_id: new mongoose.Types.ObjectId(n.authorId),
    elapsed_seconds: n.elapsedSeconds,
    shared_with_trainee: n.sharedWithTrainee,
    created_at: new Date(n.createdAt),
  }));

  await booked_session.updateOne(
    { _id: sid },
    {
      $push: {
        session_live_notes: { $each: mongoNotes },
      },
    }
  );
  clearLessonLiveState(sid);
  await clearLessonClientTelemetry(sid);
}

export async function getSessionHandoffSummary(
  bookingId: string,
  userId: string,
  accountType: string
): Promise<SessionHandoffSummary | null> {
  const row = await loadBooking(bookingId);
  if (!row) return null;

  const isTrainer = accountType === "Trainer";
  const ownerId = isTrainer ? String(row.trainer_id) : String(row.trainee_id);
  if (ownerId !== String(userId)) return null;

  const peer = isTrainer ? row.trainee_info : row.trainer_info;
  const storedNotes: any[] = Array.isArray(row.session_live_notes)
    ? row.session_live_notes
    : [];
  const sharedNotes = storedNotes
    .filter((n) => n.shared_with_trainee)
    .map((n) => ({
      text: String(n.text ?? ""),
      elapsed_seconds: Number(n.elapsed_seconds ?? 0),
    }));

  const clipIds = Array.isArray(row.trainee_clip) ? row.trainee_clip : [];
  const ratings = row.ratings ?? {};
  const trainerBlock = ratings.trainer ?? ratings.trainer_rating;
  const traineeBlock = ratings.trainee ?? ratings.trainee_rating;
  const viewerRated = isTrainer
    ? !!(trainerBlock && (trainerBlock.sessionRating || trainerBlock.audioVideoRating))
    : !!(traineeBlock && (traineeBlock.sessionRating || traineeBlock.audioVideoRating));

  const reportDoc = await Report.findOne({
    sessions: row._id,
    trainer: row.trainer_id,
    trainee: row.trainee_id,
  })
    .select("title reportData updatedAt")
    .lean();
  const reportItems = Array.isArray((reportDoc as any)?.reportData)
    ? (reportDoc as any).reportData
    : [];
  const hasGamePlanContent =
    reportItems.length > 0 || !!(row.report && String(row.report).trim());
  const expectedAt = row.game_plan_expected_at
    ? new Date(row.game_plan_expected_at)
    : null;
  const gamePlanStatus: SessionHandoffSummary["game_plan_status"] = hasGamePlanContent
    ? "available"
    : expectedAt && expectedAt.getTime() > Date.now()
      ? "pending"
      : "none";

  return {
    sessionId: String(row._id),
    status: String(row.status ?? ""),
    duration_minutes: row.duration_minutes ?? null,
    total_extended_minutes: Number(row.total_extended_minutes ?? 0),
    clips_reviewed_count: clipIds.length,
    live_notes_count: storedNotes.length,
    shared_notes: sharedNotes,
    can_rate: !viewerRated && ["completed", "confirm", "confirmed"].includes(String(row.status ?? "").toLowerCase()),
    can_rebook: !isTrainer,
    game_plan_status: gamePlanStatus,
    game_plan_title: (reportDoc as any)?.title
      ? String((reportDoc as any).title)
      : null,
    game_plan_expected_by: expectedAt ? expectedAt.toISOString() : null,
    game_plan_updated_at: (reportDoc as any)?.updatedAt
      ? new Date((reportDoc as any).updatedAt).toISOString()
      : null,
    peer: peer
      ? {
          _id: String(peer._id),
          fullname: peer.fullname ?? null,
          role: isTrainer ? "trainee" : "trainer",
        }
      : null,
    ended_at: row.end_time ? new Date(row.end_time).toISOString() : row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}
