import mongoose from "mongoose";
import user from "../model/user.schema";

export async function isChatBlocked(
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  const [a, b] = await Promise.all([
    user.findById(userIdA).select("blockedUsers").lean(),
    user.findById(userIdB).select("blockedUsers").lean(),
  ]);
  if (!a || !b) return false;
  const aBlocked = (a.blockedUsers ?? []).map(String);
  const bBlocked = (b.blockedUsers ?? []).map(String);
  return aBlocked.includes(String(userIdB)) || bBlocked.includes(String(userIdA));
}

export async function assertSessionParticipant(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const booked_session = require("../model/booked_sessions.schema").default;
  if (!mongoose.isValidObjectId(sessionId)) return false;
  const row = await booked_session
    .findById(sessionId)
    .select("trainer_id trainee_id")
    .lean();
  if (!row) return false;
  return (
    String(row.trainer_id) === String(userId) ||
    String(row.trainee_id) === String(userId)
  );
}
