import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const moneyRequestSchema: Schema = new Schema(
  {
    wallet_amount: {
      type: String,
    },
    requested_amount: {
      type: String,
    },
    payment_status: {
      type: String,
      enum: ["requested", "pending", "approved"],
      default: "requested"
    },
    trainer: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
  },
  { timestamps: true }
);

const report = Model(Tables.trainer_money_request, moneyRequestSchema);
export default report;
