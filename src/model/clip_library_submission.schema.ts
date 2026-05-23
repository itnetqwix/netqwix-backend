import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

export const LIBRARY_SUBMISSION_STATUSES = [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
] as const;

export type LibrarySubmissionStatus = (typeof LIBRARY_SUBMISSION_STATUSES)[number];

const clipLibrarySubmissionSchema = new Schema(
  {
    source_clip_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip,
      required: true,
    },
    requester_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
    },
    proposed_category_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_category,
      required: true,
    },
    proposed_subcategory_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_subcategory,
      required: true,
    },
    assigned_category_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_category,
      default: null,
    },
    assigned_subcategory_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_subcategory,
      default: null,
    },
    status: {
      type: String,
      enum: LIBRARY_SUBMISSION_STATUSES,
      default: "submitted",
    },
    rejection_reason: { type: String, default: null },
    reviewed_by: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
    reviewed_at: { type: Date, default: null },
    published_library_clip_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip,
      default: null,
    },
  },
  { timestamps: true }
);

clipLibrarySubmissionSchema.index({ requester_user_id: 1, status: 1 });
clipLibrarySubmissionSchema.index({ source_clip_id: 1 });
clipLibrarySubmissionSchema.index({ status: 1, createdAt: -1 });

const clip_library_submission = Model(
  Tables.clip_library_submission,
  clipLibrarySubmissionSchema
);
export default clip_library_submission;
