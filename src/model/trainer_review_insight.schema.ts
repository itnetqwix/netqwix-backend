import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

const insightPayloadSchema = new Schema(
  {
    overallSentiment: { type: String },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    summary: { type: String },
    reviewCount: { type: Number, default: 0 },
    degraded: { type: Boolean, default: false },
  },
  { _id: false }
);

const insightSlotSchema = new Schema(
  {
    fingerprint: { type: String, required: true },
    generated_at: { type: Date, required: true },
    payload: { type: insightPayloadSchema, required: true },
  },
  { _id: false }
);

/**
 * Per-trainer AI review insights — refreshed at most every 3 days, or sooner when
 * platform activity (reviews, sessions, clips, profile) changes.
 */
const trainerReviewInsightSchema = new Schema(
  {
    trainer_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      unique: true,
      index: true,
    },
    expires_at: { type: Date, required: true, index: true },
    current: { type: insightSlotSchema, required: true },
    /** Prior insight when activity changed within the same refresh window. */
    previous: { type: insightSlotSchema, default: null },
  },
  { timestamps: true }
);

export default Model(Tables.trainer_review_insight, trainerReviewInsightSchema);
