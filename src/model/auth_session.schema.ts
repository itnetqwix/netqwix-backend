import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: Tables.user, required: true, index: true },
    /** Public id shown in the app (e.g. NQ-A1B2C3D4). */
    publicId: { type: String, required: true, unique: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    clientType: {
      type: String,
      enum: ["mobile", "web", "tablet", "desktop", "unknown"],
      default: "unknown",
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },
    deviceLabel: { type: String, default: "Unknown device" },
    deviceId: { type: String },
    appVersion: { type: String },
    loginMethod: {
      type: String,
      enum: ["password", "google", "apple", "unknown"],
      default: "unknown",
    },
    ipAddress: { type: String },
    userAgent: { type: String },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

authSessionSchema.index({ userId: 1, revokedAt: 1, lastUsedAt: -1 });

const auth_session = Model(Tables.auth_sessions, authSessionSchema);
export default auth_session;
