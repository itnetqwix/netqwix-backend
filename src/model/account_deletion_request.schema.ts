import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Account deletion request log (Phase 2 item 15).
 *
 * Each row tracks a single self-serve deletion: when the OTP was confirmed,
 * the 15-day restore deadline, and any admin-driven restore/hard-delete
 * action. Mirrors the audit-trail pattern used by ops-events.
 */
const accountDeletionRequestSchema: Schema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    user_email_at_request: { type: String, default: null },
    user_fullname_at_request: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 600 },
    feedback_category: { type: String, default: null }, // optional dropdown bucket
    status: {
      type: String,
      enum: ["pending", "confirmed", "restored", "hard_deleted", "cancelled"],
      default: "pending",
      index: true,
    },
    confirmed_at: { type: Date, default: null },
    restore_deadline: { type: Date, default: null }, // confirmed_at + 15d
    hard_deleted_at: { type: Date, default: null },
    restored_at: { type: Date, default: null },
    restored_by: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
    cancelled_at: { type: Date, default: null },
    admin_notes: { type: String, default: null },
  },
  { timestamps: true }
);

accountDeletionRequestSchema.index({ status: 1, restore_deadline: 1 });

const AccountDeletionRequest = Model(
  Tables.account_deletion_request,
  accountDeletionRequestSchema
);
export default AccountDeletionRequest;
