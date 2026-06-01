import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Versioned legal copy (terms, privacy) served to mobile/web without app updates.
 */
const cmsLegalDocumentSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: ["terms", "privacy"],
      unique: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body_html: { type: String, required: true },
    version: { type: Number, default: 1 },
    is_active: { type: Boolean, default: true, index: true },
    published_at: { type: Date, default: Date.now },
    created_by: { type: Schema.Types.ObjectId, ref: Tables.user, default: null },
  },
  { timestamps: true }
);

const CmsLegalDocument = Model(Tables.cms_legal_document, cmsLegalDocumentSchema);
export default CmsLegalDocument;
