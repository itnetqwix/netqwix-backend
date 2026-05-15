import trainer_verification_audit from "../../model/trainer_verification_audit.schema";
import mongoose from "mongoose";

export async function logVerificationAudit(
  userId: string,
  action: string,
  meta?: Record<string, unknown>,
  actorId?: string
) {
  try {
    await trainer_verification_audit.create({
      user_id: new mongoose.Types.ObjectId(userId),
      action,
      meta,
      actor_id: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
    });
  } catch (e) {
    console.error("[verificationAudit]", action, e);
  }
}
