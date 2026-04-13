import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const scheduleInventorySchema: Schema = new Schema(
  {
    trainer_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    available_slots: [
      {
        day: { type: String },
        slots: [
          new Schema({
            start_time: String,
            end_time: String,
          }),
        ],
      },
    ],
  },
  { timestamps: true }
);

const schedule_inventory = Model(
  Tables.schedule_inventory,
  scheduleInventorySchema
);
export default schedule_inventory;
