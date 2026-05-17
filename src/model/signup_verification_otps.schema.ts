import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const signupVerificationOtpSchema = new Schema(
  {
    destination: { type: String, required: true, index: true },
    channel: { type: String, enum: ["email", "sms"], required: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    verified_at: { type: Date },
  },
  { timestamps: true }
);

signupVerificationOtpSchema.index({ destination: 1, channel: 1 });

export default Model(Tables.signup_verification_otps, signupVerificationOtpSchema);
