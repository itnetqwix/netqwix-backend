import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { SendEmail } from "../../Utils/sendEmail";
import { VERIFICATION_CONFIG } from "../../config/verification";

export class TraineeAccountReviewService {
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

    SendEmail.sendRawEmail(
      "verification-rejected",
      {
        "[NAME]": updated!.fullname,
        "[REASON]": reason.trim(),
        "[FRONTEND_URL]": VERIFICATION_CONFIG.frontendUrl,
      },
      [updated!.email],
      "Update on your NetQwix account",
      `Hi ${updated!.fullname}, we could not approve your account: ${reason}`
    );

    return updated;
  }

  async approveTrainee(userId: string) {
    const u = await user.findOne({ _id: userId, account_type: AccountType.TRAINEE });
    if (!u) throw new Error("Trainee not found");
    return user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "approved",
          account_rejection_reason: "",
        },
      },
      { new: true }
    );
  }

  async reapplyTrainee(userId: string) {
    const u = await user.findOne({ _id: userId, account_type: AccountType.TRAINEE });
    if (!u) throw new Error("Trainee not found");
    if (u.status !== "rejected") throw new Error("Account is not in rejected state");
    return user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "pending",
          account_rejection_reason: "",
        },
      },
      { new: true }
    );
  }
}

export const traineeAccountReviewService = new TraineeAccountReviewService();
