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
    category_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_category,
      default: null,
    },
    subcategory_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_subcategory,
      default: null,
    },
    clip_scope: {
      type: String,
      enum: ["personal", "library"],
      default: "personal",
    },
    library_source_submission_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_library_submission,
      default: null,
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
      ref: "user",
    },
    shared_from_user_id: {
      type: Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
    shared_at: {
      type: Date,
      default: null,
    },
    source_clip_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip,
      default: null,
    },
    file_size_bytes: {
      type: Number,
      default: 0,
    },
    user_type: {
      type: String,
      enum: ["Trainer", "Trainee", "Admin"],
    },
    status: {                    
      type : Boolean,
      default : true,
    },
    tags: {
      type: [String],
      default: [],
    },
    ai_description: {
      type: String,
      default: null,
    },
    skill_level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced", null],
      default: null,
    },
  },
  { timestamps: true }
);

const clip = Model(Tables.clip, clipSchema);
export default clip;
