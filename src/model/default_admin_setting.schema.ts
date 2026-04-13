import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const adminSettingSchema: Schema = new Schema(
  {
    commission: {
      type: Number,
      default: 5,
    },
    last_updated_admin_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
  },
  { timestamps: true }
);

const admin_setting = Model(
  Tables.admin_setting,
  adminSettingSchema
);
export default admin_setting;
