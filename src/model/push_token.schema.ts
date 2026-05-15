import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const pushTokenSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "user", required: true },
    token: { type: String, required: true },
    platform: { type: String, enum: ["ios", "android", "web"], default: "android" },
    deviceId: { type: String, required: true },
    kind: { type: String, enum: ["expo", "native"], default: "expo" },
  },
  { timestamps: true }
);

pushTokenSchema.index({ userId: 1 });
pushTokenSchema.index({ deviceId: 1 }, { unique: true });

const push_token = Model(Tables.push_token, pushTokenSchema);
export default push_token;
