import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const userPresenceSchema: Schema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      unique: true,
    },
    last_seen_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

const user_presence = Model(Tables.user_presence, userPresenceSchema);
export default user_presence;
