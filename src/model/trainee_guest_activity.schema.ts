import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Captures everything a user did while browsing as a guest — viewed trainers,
 * search queries, favorites — so the home feed can seed personalised
 * recommendations immediately after sign-up instead of starting cold.
 *
 * Document is keyed by `trainee_id` and merged on each replay POST. Arrays
 * are capped server-side as a defense-in-depth check on top of the
 * client-side caps in `nq-mobile/src/features/auth/lib/guestActivity.ts`.
 */

const viewedTrainerSchema = new Schema(
  {
    trainer_id: { type: Types.ObjectId, ref: Tables.user, required: true },
    view_count: { type: Number, default: 1, min: 1 },
    /** Most recent view timestamp from the client (ms). */
    last_viewed_at: { type: Date, required: true },
  },
  { _id: false }
);

const recentSearchSchema = new Schema(
  {
    q: { type: String, required: true, trim: true, maxlength: 80 },
    last_searched_at: { type: Date, required: true },
  },
  { _id: false }
);

const favoriteSnapshotSchema = new Schema(
  {
    trainer_id: { type: Types.ObjectId, ref: Tables.user, required: true },
    favorited_at: { type: Date, required: true },
  },
  { _id: false }
);

const eventLogSchema = new Schema(
  {
    kind: { type: String, enum: ["view", "search", "favorite"], required: true },
    ref: { type: String, required: true, maxlength: 80 },
    t: { type: Date, required: true },
  },
  { _id: false }
);

const traineeGuestActivitySchema = new Schema(
  {
    trainee_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      unique: true,
      index: true,
    },
    viewed_trainers: { type: [viewedTrainerSchema], default: [] },
    recent_searches: { type: [recentSearchSchema], default: [] },
    favorites_snapshot: { type: [favoriteSnapshotSchema], default: [] },
    event_log: { type: [eventLogSchema], default: [] },
    /** Bumped every time the client replays — useful for "stale guest" debug. */
    last_ingested_at: { type: Date, required: true, default: () => new Date() },
    /** Cleared once recommendations have actually consumed this seed. */
    consumed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

export default Model(Tables.trainee_guest_activity, traineeGuestActivitySchema);
