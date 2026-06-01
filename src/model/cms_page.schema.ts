import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

/**
 * CMS pages: blogs, help articles, marketing pages.
 */
const cmsPageSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["blog", "page"],
      default: "blog",
      index: true,
    },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    excerpt: { type: String, default: "", trim: true, maxlength: 500 },
    body_html: { type: String, required: true },
    cover_image_url: { type: String, default: null },
    video_url: { type: String, default: null },
    audience: {
      type: [String],
      enum: ["guest", "trainer", "trainee", "all"],
      default: ["all"],
    },
    cta_label: { type: String, default: null },
    cta_url: { type: String, default: null },
    is_active: { type: Boolean, default: true, index: true },
    sort_order: { type: Number, default: 0, index: true },
    published_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
  },
  { timestamps: true }
);

cmsPageSchema.index({ type: 1, slug: 1 }, { unique: true });
cmsPageSchema.index({ type: 1, is_active: 1, sort_order: 1 });

const CmsPage = Model(Tables.cms_page, cmsPageSchema);
export default CmsPage;
