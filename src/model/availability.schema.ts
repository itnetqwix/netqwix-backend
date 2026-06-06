import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const availabilitySchema: Schema = new Schema(
  {
    trainer_id: { type: Schema.Types.ObjectId, ref: "user" },
    start_time: { type: Date },
    end_time: { type: Date },
    status: { type: Boolean, default: false }
  },
  { timestamps: true }
);

availabilitySchema.index({ trainer_id: 1, start_time: 1, end_time: 1 });
availabilitySchema.index({ trainer_id: 1, status: 1 });

const availability = Model(Tables.availability, availabilitySchema);
export default availability;