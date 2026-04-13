import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const savedSessionsSchema: Schema = new Schema(
  {
    title: {
      type: String,
    },
    description: {
      type: String,
    },
    file_name: {
      type: String,
      default: ""
    },
    file_type: {
      type: String,
    },
    file_id: {
      type: String,
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
    trainee_name: {
      type: String,
    }, 
    trainer_name: {
      type: String,
    },
    status : {
      type : Boolean,
      default : true
    }
  },
  { timestamps: true }
);

const saved_session = Model(Tables.saved_session,savedSessionsSchema);
export default saved_session;
