import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const clipSubcategorySchema = new Schema(
  {
    category_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.clip_category,
      required: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    sort_order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    created_by_admin: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
  },
  { timestamps: true }
);

clipSubcategorySchema.index({ category_id: 1, slug: 1 }, { unique: true });
clipSubcategorySchema.index({ category_id: 1, is_active: 1, sort_order: 1 });

const clip_subcategory = Model(Tables.clip_subcategory, clipSubcategorySchema);
export default clip_subcategory;
