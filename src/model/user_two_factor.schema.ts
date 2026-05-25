import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * TOTP-based two-factor for trainers. The secret is encrypted at rest
 * (AES-256-GCM via the `secret_cipher` columns); plain-text secrets
 * never touch disk. Recovery codes are stored hashed (SHA-256) and
 * single-use — invalidated on first match.
 *
 * `pending_secret_*` columns let us start enrolment (show QR) without
 * activating 2FA until the user proves they can read it back.
 */
const recoveryCodeSchema = new Schema(
  {
    code_hash: { type: String, required: true },
    used_at: { type: Date, default: null },
  },
  { _id: false }
);

const userTwoFactorSchema = new Schema(
  {
    user_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      unique: true,
      index: true,
    },
    enabled: { type: Boolean, default: false },
    /** "totp" only for now — Stripe / SMS variants reserved. */
    method: { type: String, enum: ["totp"], default: "totp" },
    /** Active secret (base32) encrypted with AES-GCM. */
    secret_cipher: { type: String, default: null, select: false },
    secret_iv: { type: String, default: null, select: false },
    secret_tag: { type: String, default: null, select: false },
    /** Pending enrolment secret — promoted to `secret_*` on first verify. */
    pending_secret_cipher: { type: String, default: null, select: false },
    pending_secret_iv: { type: String, default: null, select: false },
    pending_secret_tag: { type: String, default: null, select: false },
    pending_started_at: { type: Date, default: null },
    enabled_at: { type: Date, default: null },
    last_verified_at: { type: Date, default: null },
    recovery_codes: { type: [recoveryCodeSchema], default: [] },
  },
  { timestamps: true }
);

export default Model("user_two_factor", userTwoFactorSchema);
