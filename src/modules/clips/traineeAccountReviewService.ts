import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { SendEmail } from "../../Utils/sendEmail";
import { VERIFICATION_CONFIG } from "../../config/verification";
import { logVerificationAudit } from "../verification/verificationAudit";
import { verificationEmailPlaceholders } from "../verification/emailPlaceholders";

async function sendAccountReviewPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  try {
    const { notificationsService } = await import("../notifications/notificationsService");
    const push = new notificationsService();
    await push.sendPushNotification(userId, title, body, {
      category: "account_verification",
      ...data,
    });
  } catch (e) {
    console.error("[traineeAccountReview] push failed", e);
  }
}

export class TraineeAccountReviewService {
  async listPending(query: Record<string, unknown> = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const filter: Record<string, unknown> = {
      account_type: AccountType.TRAINEE,
      status: "pending",
    };
    const [items, total] = await Promise.all([
      user
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("fullname email mobile_no profile_picture status account_rejection_reason createdAt updatedAt")
        .lean(),
      user.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async rejectTrainee(userId: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw new Error("Rejection reason is required");
    const u = await user.findOne({ _id: userId, account_type: AccountType.TRAINEE });
    if (!u) throw new Error("Trainee not found");

    const updated = await user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "rejected",
          account_rejection_reason: reason.trim(),
        },
      },
      { new: true }
    );

    await logVerificationAudit(userId, "trainee_admin_rejected", { reason: reason.trim() }, adminId);

    SendEmail.sendRawEmail(
      "verification-rejected",
      verificationEmailPlaceholders({
        name: updated!.fullname,
        frontendUrl: VERIFICATION_CONFIG.frontendUrl,
        reason: reason.trim(),
      }),
      [updated!.email],
      "Update on your NetQwix account",
      `Hi ${updated!.fullname}, we could not approve your account: ${reason}`
    );

    await sendAccountReviewPush(
      userId,
      "Account update",
      "Your account needs attention. Open the app to review and resubmit.",
      { kind: "account_rejected" }
    );

    return updated;
  }

  async approveTrainee(userId: string, adminId?: string) {
    const u = await user.findOne({ _id: userId, account_type: AccountType.TRAINEE });
    if (!u) throw new Error("Trainee not found");
    const updated = await user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "approved",
          account_rejection_reason: "",
        },
      },
      { new: true }
    );

    await logVerificationAudit(userId, "trainee_admin_approved", {}, adminId);

    SendEmail.sendRawEmail(
      "verification-approved",
      verificationEmailPlaceholders({
        name: updated!.fullname,
        frontendUrl: VERIFICATION_CONFIG.frontendUrl,
      }),
      [updated!.email],
      "Your NetQwix account is approved",
      `Hi ${updated!.fullname}, your account has been approved.`
    );

    await sendAccountReviewPush(
      userId,
      "Account approved",
      "Your NetQwix account is approved. You can continue using the app.",
      { kind: "account_approved" }
    );

    return updated;
  }

  async reapplyTrainee(userId: string) {
    const u = await user.findOne({ _id: userId, account_type: AccountType.TRAINEE });
    if (!u) throw new Error("Trainee not found");
    if (u.status !== "rejected") throw new Error("Account is not in rejected state");
    const updated = await user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "pending",
          account_rejection_reason: "",
        },
      },
      { new: true }
    );
    await logVerificationAudit(userId, "trainee_user_reapplied", {});
    return updated;
  }
}

export const traineeAccountReviewService = new TraineeAccountReviewService();
