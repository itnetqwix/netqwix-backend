import user from "../../model/user.schema";
import { SendEmail } from "../../Utils/sendEmail";
import { VERIFICATION_CONFIG } from "../../config/verification";
import { buildOnboardingStatus, getTrainerVerification } from "./onboardingHelpers";
import { rekognitionLivenessService } from "./rekognitionLivenessService";
import { logVerificationAudit } from "./verificationAudit";
import { recordOpsEvent } from "../ops/opsEventService";

export class OnboardingService {
  async getStatus(userId: string) {
    const u = await user.findById(userId).lean();
    if (!u) throw new Error("User not found");
    return buildOnboardingStatus(u);
  }

  async updateProfile(userId: string, body: Record<string, unknown>) {
    const u = await user.findById(userId);
    if (!u) throw new Error("User not found");

    const tv = getTrainerVerification(u);
    if (!["contact_verified", "profile_face_complete", "account_created"].includes(tv.onboarding_step || "")) {
      if (tv.onboarding_step === "under_review" || tv.onboarding_step === "completed") {
        throw new Error("Profile cannot be edited while under review or after approval.");
      }
    }

    if (body.category) u.category = String(body.category);
    if (body.profile_picture) u.profile_picture = String(body.profile_picture);
    if (body.extraInfo && typeof body.extraInfo === "object") {
      u.extraInfo = { ...(u.extraInfo || {}), ...(body.extraInfo as object) };
    }
    const bio = (body as any).bio;
    if (bio) {
      u.extraInfo = { ...(u.extraInfo || {}), bio: String(bio) };
    }

    if (!u.category) throw new Error("Trainer category is required.");
    if (!u.profile_picture) throw new Error("Profile picture is required.");

    u.trainer_verification = u.trainer_verification || {};
    u.trainer_verification.profile_completed_at = new Date();
    if (u.trainer_verification.onboarding_step === "contact_verified") {
      u.trainer_verification.onboarding_step = "profile_face_complete";
    }
    await u.save();
    await logVerificationAudit(userId, "profile_updated");
    return buildOnboardingStatus(u.toObject());
  }

  async createFaceSession(userId: string) {
    const session = await rekognitionLivenessService.createSession(userId);
    await user.findByIdAndUpdate(userId, {
      $set: {
        "trainer_verification.face.rekognition_session_id": session.sessionId,
      },
    });
    await logVerificationAudit(userId, "face_session_created", { sessionId: session.sessionId });
    return session;
  }

  async completeFaceSession(userId: string, sessionId?: string) {
    const u = await user.findById(userId);
    if (!u) throw new Error("User not found");

    const sid = sessionId || u.trainer_verification?.face?.rekognition_session_id;
    if (!sid) throw new Error("No face liveness session");

    if (!u.category || !u.profile_picture) {
      throw new Error("Complete your profile before submitting face verification.");
    }

    const result = await rekognitionLivenessService.getSessionResults(sid, userId);
    if (!result.isLive) {
      await logVerificationAudit(userId, "face_liveness_failed", result as any);
      throw new Error(
        `Face verification failed (${result.status}, confidence ${result.confidence?.toFixed?.(0) || 0}%). Remove mask/sunglasses, improve lighting, and try again.`
      );
    }

    const now = new Date();
    u.trainer_verification = u.trainer_verification || {};
    u.trainer_verification.face = {
      rekognition_session_id: sid,
      confidence: result.confidence,
      liveness_status: result.status,
      reference_image_s3_key: result.reference_image_s3_key,
      submitted_at: now,
    };
    u.trainer_verification.onboarding_step = "under_review";
    u.trainer_verification.submitted_for_review_at = now;
    u.status = "pending";
    await u.save();

    await logVerificationAudit(userId, "submitted_for_review", result as any);
    await this.sendSubmittedEmails(u);

    recordOpsEvent({
      category: "admin",
      severity: "info",
      event_type: "TRAINER_VERIFICATION_SUBMITTED",
      user_id: userId,
      title: `Trainer verification submitted: ${u.fullname}`,
      source: "server",
    });

    return buildOnboardingStatus(u.toObject());
  }

  private async sendSubmittedEmails(u: any) {
    const frontend = VERIFICATION_CONFIG.frontendUrl;
    SendEmail.sendRawEmail(
      "verification-submitted-user",
      {
        "[NAME]": u.fullname,
        "[FRONTEND_URL]": frontend,
      },
      [u.email],
      "Your NetQwix trainer application was received",
      `Hi ${u.fullname}, we received your verification. Our team will review within 48 hours.`
    );

    const adminEmails = VERIFICATION_CONFIG.adminAlertEmails;
    if (adminEmails.length) {
      const adminUrl =
        (VERIFICATION_CONFIG.adminFrontendUrl || frontend) + "/apps/trainer-verifications";
      SendEmail.sendRawEmail(
        "verification-submitted-admin",
        {
          "[TRAINER_NAME]": u.fullname,
          "[EMAIL]": u.email,
          "[PHONE]": u.mobile_no || "",
          "[ADMIN_URL]": adminUrl,
        },
        adminEmails,
        `Trainer verification ready for review: ${u.fullname}`,
        `Review ${u.fullname} at ${adminUrl}`
      );
    }
  }
}

export const onboardingService = new OnboardingService();
