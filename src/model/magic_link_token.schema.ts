import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * One-shot tokens for "email me a sign-in link" flow. We store only a
 * SHA-256 hash of the underlying secret so even a leaked snapshot of this
 * collection can't be replayed. A row is consumed (via `consumed_at`) the
 * first time it's exchanged for a session; subsequent verifies must fail.
 *
 * `code` is a short numeric fallback (6 digits) for users who'd rather type
 * the code from the email than click the deep link. Both code and link
 * resolve to the same row.
 */
const magicLinkTokenSchema = new Schema(
  {
    user_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    token_hash: { type: String, required: true, index: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true, index: true },
    consumed_at: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    /** IP that requested the link — surfaced in the email body for trust. */
    requested_ip: { type: String, default: "" },
    requested_user_agent: { type: String, default: "" },
  },
  { timestamps: true }
);

magicLinkTokenSchema.index({ user_id: 1, consumed_at: 1, expires_at: 1 });

export default Model(Tables.magic_link_tokens, magicLinkTokenSchema);
