import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const reportSchema: Schema = new Schema(
  {
    title: {
      type: String,
    },
    description: {
      type: String,
    },
    reportData: {
      type: Array
    },
    sessions: {
      type: Schema.Types.ObjectId,
      ref: "booked_sessions",
    },
    trainer: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    trainee: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    status: {
      type : Boolean,
      default : true
    }
  },
  { timestamps: true }
);

const report = Model(Tables.report, reportSchema);
export default report;
