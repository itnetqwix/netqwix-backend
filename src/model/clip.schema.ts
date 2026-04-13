import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const clipSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: false,
    },
    file_name: {
      type: String,
      default: ""
    },
    thumbnail: {
      type: String,
      default: ""
    },
    file_type: {
      type: String,
    },
    file_id: {
      type: String,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    user_type: {
      type: String,
      enum: ["Trainer", "Trainee", "Admin"],
    },
    status: {                    
      type : Boolean,
      default : true,
    }
  },
  { timestamps: true }
);

const clip = Model(Tables.clip, clipSchema);
export default clip;
