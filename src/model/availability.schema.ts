import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const availabilitySchema: Schema = new Schema(
  {
    trainer_id: { type: Schema.Types.ObjectId, ref: "users" },
    start_time: { type: Date },
    end_time: { type: Date },
    status: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const availability = Model(Tables.availability, availabilitySchema);
export default availability;