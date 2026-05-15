import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const verificationOtpSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    channel: { type: String, enum: ["email", "sms"], required: true },
    destination: { type: String, required: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    verified_at: { type: Date },
  },
  { timestamps: true }
);

verificationOtpSchema.index({ user_id: 1, channel: 1 });
verificationOtpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default Model(Tables.verification_otps, verificationOtpSchema);
