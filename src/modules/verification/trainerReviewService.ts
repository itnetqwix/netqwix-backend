import user from "../../model/user.schema";
import trainer_verification_audit from "../../model/trainer_verification_audit.schema";
import { AccountType } from "../auth/authEnum";
import { SendEmail } from "../../Utils/sendEmail";
import { VERIFICATION_CONFIG } from "../../config/verification";
import { rekognitionLivenessService } from "./rekognitionLivenessService";
import { logVerificationAudit } from "./verificationAudit";
import { recordOpsEvent } from "../ops/opsEventService";

export class TrainerReviewService {
  async list(query: Record<string, unknown> = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const filter: Record<string, unknown> = {
      account_type: AccountType.TRAINER,
      "trainer_verification.onboarding_step": "under_review",
    };
    if (query.escalated === "true") {
      filter["trainer_verification.review_escalated_at"] = { $ne: null };
    }
    if (query.status) filter.status = query.status;

    const [items, total] = await Promise.all([
      user
        .find(filter)
        .sort({ "trainer_verification.submitted_for_review_at": 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("fullname email mobile_no category profile_picture status trainer_verification createdAt")
        .lean(),
      user.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  async getDetail(userId: string) {
    const u = await user.findById(userId).lean();
    if (!u) throw new Error("User not found");
    const key = u.trainer_verification?.face?.reference_image_s3_key;
    const selfieUrl = key ? rekognitionLivenessService.getPresignedUrl(key) : null;
    const audit = await trainer_verification_audit
      .find({ user_id: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return { user: u, selfieUrl, audit };
  }

  async approve(userId: string, adminId: string) {
    const u = await user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "approved",
          "trainer_verification.onboarding_step": "completed",
          "trainer_verification.rejection_reason": "",
        },
      },
      { new: true }
    );
    if (!u) throw new Error("User not found");

    await logVerificationAudit(userId, "admin_approved", {}, adminId);
    SendEmail.sendRawEmail(
      "verification-approved",
      { "[NAME]": u.fullname, "[FRONTEND_URL]": VERIFICATION_CONFIG.frontendUrl },
      [u.email],
      "Your NetQwix trainer account is approved",
      `Congratulations ${u.fullname}, you can now access NetQwix.`
    );
    return u;
  }

  async reject(userId: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw new Error("Rejection reason is required");
    const u = await user.findByIdAndUpdate(
      userId,
      {
        $set: {
          status: "rejected",
          "trainer_verification.rejection_reason": reason.trim(),
          "trainer_verification.onboarding_step": "profile_face_complete",
        },
      },
      { new: true }
    );
    if (!u) throw new Error("User not found");

    await logVerificationAudit(userId, "admin_rejected", { reason }, adminId);
    SendEmail.sendRawEmail(
      "verification-rejected",
      { "[NAME]": u.fullname, "[REASON]": reason, "[FRONTEND_URL]": VERIFICATION_CONFIG.frontendUrl },
      [u.email],
      "Update on your NetQwix trainer application",
      `Hi ${u.fullname}, we could not approve your application: ${reason}`
    );
    return u;
  }

  async runMigration(dryRun = true) {
    const graceDeadline = new Date(
      Date.now() + VERIFICATION_CONFIG.graceDays * 24 * 60 * 60 * 1000
    );
    const trainers = await user.find({ account_type: AccountType.TRAINER }).lean();
    let completed = 0;
    let grace = 0;
    for (const t of trainers) {
      const tv = t.trainer_verification || {};
      if (t.status === "approved" && !tv.submitted_for_review_at) {
        if (!dryRun) {
          await user.findByIdAndUpdate(t._id, {
            $set: { "trainer_verification.onboarding_step": "completed" },
          });
        }
        completed++;
      } else if (!dryRun) {
        await user.findByIdAndUpdate(t._id, {
          $set: {
            "trainer_verification.grace_deadline": graceDeadline,
            "trainer_verification.onboarding_step":
              tv.onboarding_step || "account_created",
          },
        });
        grace++;
      } else {
        grace++;
      }
    }
    return { dryRun, completed, grace, graceDeadline };
  }

  async processSlaEscalations() {
    const cutoff = new Date(Date.now() - VERIFICATION_CONFIG.slaHours * 60 * 60 * 1000);
    const pending = await user
      .find({
        account_type: AccountType.TRAINER,
        "trainer_verification.onboarding_step": "under_review",
        "trainer_verification.submitted_for_review_at": { $lte: cutoff },
        "trainer_verification.review_escalated_at": null,
      })
      .lean();

    const adminEmails = VERIFICATION_CONFIG.adminAlertEmails;
    for (const t of pending) {
      await user.findByIdAndUpdate(t._id, {
        $set: { "trainer_verification.review_escalated_at": new Date() },
      });
      await logVerificationAudit(String(t._id), "sla_escalated");

      recordOpsEvent({
        category: "admin",
        severity: "warning",
        event_type: "TRAINER_VERIFICATION_SLA_BREACH",
        user_id: String(t._id),
        title: `Trainer verification SLA breach: ${t.fullname}`,
        summary: `Submitted ${t.trainer_verification?.submitted_for_review_at}`,
        source: "server",
      });

      if (adminEmails.length) {
        SendEmail.sendRawEmail(
          null,
          null,
          adminEmails,
          `URGENT: Trainer verification overdue — ${t.fullname}`,
          null,
          `<p>Trainer <strong>${t.fullname}</strong> (${t.email}) has been waiting more than ${VERIFICATION_CONFIG.slaHours} hours for review.</p>`
        );
      }
    }
    return { escalated: pending.length };
  }
}

export const trainerReviewService = new TrainerReviewService();
