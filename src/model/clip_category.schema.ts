import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const clipCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    sort_order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    created_by_admin: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
  },
  { timestamps: true }
);

clipCategorySchema.index({ slug: 1 }, { unique: true });
clipCategorySchema.index({ is_active: 1, sort_order: 1 });

const clip_category = Model(Tables.clip_category, clipCategorySchema);
export default clip_category;
