import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * One row per (session, user, cadence-mark) reminder we've sent. Lets the
 * reminder dispatcher be idempotent — even if the cron crashes / restarts
 * in the middle of a minute, each user only gets one push per mark.
 */
const bookingReminderLogSchema = new Schema(
  {
    session_id: {
      type: Types.ObjectId,
      ref: Tables.booked_sessions,
      required: true,
      index: true,
    },
    user_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["h24", "h1", "m10", "m1"],
      required: true,
    },
    sent_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

bookingReminderLogSchema.index(
  { session_id: 1, user_id: 1, kind: 1 },
  { unique: true }
);

export default Model(Tables.booking_reminder_log, bookingReminderLogSchema);
