import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const userActivitySchema: Schema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      required: true,
      index: true,
    },
    meta: {
      type: Object,
      default: {},
    },
    ip: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true }
);

userActivitySchema.index({ user_id: 1, createdAt: -1 });

const user_activity = Model(Tables.user_activity, userActivitySchema);
export default user_activity;
