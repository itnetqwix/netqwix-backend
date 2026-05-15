/** Trainer onboarding / verification configuration. */
export const VERIFICATION_CONFIG = {
  otpTtlSeconds: Number(process.env.VERIFICATION_OTP_TTL_SECONDS) || 600,
  otpMaxAttempts: Number(process.env.VERIFICATION_OTP_MAX_ATTEMPTS) || 5,
  otpLength: 6,
  slaHours: Number(process.env.TRAINER_VERIFICATION_SLA_HOURS) || 48,
  graceDays: Number(process.env.TRAINER_VERIFICATION_GRACE_DAYS) || 30,
  rekognitionRegion: process.env.AWS_REKOGNITION_REGION || process.env.AWS_REGION || "us-east-1",
  verificationBucket: process.env.VERIFICATION_S3_BUCKET || process.env.AWS_BUCKET_NAME || "",
  livenessConfidenceMin: Number(process.env.VERIFICATION_LIVENESS_CONFIDENCE_MIN) || 90,
  mockLiveness: process.env.VERIFICATION_MOCK_LIVENESS === "true",
  adminAlertEmails: (process.env.ADMIN_VERIFICATION_ALERT_EMAILS || process.env.EMAIL_USER || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL || "https://www.netqwix.com",
  adminFrontendUrl: process.env.ADMIN_FRONTEND_URL || process.env.FRONTEND_URL || "",
};

export const ONBOARDING_STEPS = [
  "account_created",
  "contact_verified",
  "profile_face_complete",
  "under_review",
  "completed",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
