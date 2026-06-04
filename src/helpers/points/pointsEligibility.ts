import user from "../../model/user.schema";
import { AccountType } from "../../modules/auth/authEnum";

export type PointsBlockReason =
  | "user_not_found"
  | "account_deleted"
  | "pending_deletion"
  | "hibernated"
  | "invalid_account_type";

export type PointsEligibility = {
  allowed: boolean;
  reason?: PointsBlockReason;
  message?: string;
};

/**
 * Registered Trainer/Trainee only — not deleted, hibernating, or pending deletion.
 * Guest browsing has no authenticated user; this runs on authenticated points APIs.
 */
export async function getPointsEligibility(userId: string): Promise<PointsEligibility> {
  const u: any = await user
    .findById(userId)
    .select("account_type deleted_at pending_deletion_at hibernated_at")
    .lean();
  if (!u) {
    return { allowed: false, reason: "user_not_found", message: "User not found." };
  }
  if (u.deleted_at) {
    return {
      allowed: false,
      reason: "account_deleted",
      message: "Points are not available for deleted accounts.",
    };
  }
  if (u.pending_deletion_at) {
    return {
      allowed: false,
      reason: "pending_deletion",
      message: "Points are paused while account deletion is pending.",
    };
  }
  if (u.hibernated_at) {
    return {
      allowed: false,
      reason: "hibernated",
      message: "Points are not available while your account is hibernating.",
    };
  }
  if (u.account_type !== AccountType.TRAINER && u.account_type !== AccountType.TRAINEE) {
    return {
      allowed: false,
      reason: "invalid_account_type",
      message: "Points are only available for coach and trainee accounts.",
    };
  }
  return { allowed: true };
}
