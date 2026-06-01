import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const faqItemSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answer: { type: String, required: true, trim: true, maxlength: 2000 },
    sort_order: { type: Number, default: 0 },
  },
  { _id: true }
);

const faqSectionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    sort_order: { type: Number, default: 0 },
    items: { type: [faqItemSchema], default: [] },
  },
  { _id: true }
);

/**
 * Mobile FAQ — one active bundle (slug `mobile`). Replaces static TS in the app when published.
 */
const cmsFaqSchema = new Schema(
  {
    slug: { type: String, default: "mobile", unique: true },
    sections: { type: [faqSectionSchema], default: [] },
    version: { type: Number, default: 1 },
    is_active: { type: Boolean, default: true, index: true },
    published_at: { type: Date, default: Date.now },
    created_by: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
  },
  { timestamps: true }
);

const CmsFaq = Model(Tables.cms_faq, cmsFaqSchema);
export default CmsFaq;
