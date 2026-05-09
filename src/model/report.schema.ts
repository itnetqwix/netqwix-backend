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
      ref: "user",
    },
    trainee: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    status: {
      type : Boolean,
      default : true
    },
    /** S3 key (e.g. session-rec-*.webm) for full instant-lesson session recording */
    sessionRecordingUrl: {
      type: String,
    },
  },
  { timestamps: true }
);

const report = Model(Tables.report, reportSchema);
export default report;
