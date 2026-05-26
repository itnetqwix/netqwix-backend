import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Admin-managed home / announcement banners (Phase 2 item 17).
 *
 * Banners are rendered as a single full-width card at the top of the
 * mobile home screen (or the login/auth screens when `audience` includes
 * `guest`). Admins schedule them, choose severity for colouring, and can
 * mark them dismissible — the mobile client remembers dismissals locally
 * (no per-user-per-banner record in the db).
 */
const homeBannerSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 600 },
    image_url: { type: String, default: null },
    audience: {
      type: [String],
      enum: ["guest", "trainer", "trainee", "all"],
      default: ["all"],
    },
    severity: {
      type: String,
      enum: ["info", "promo", "maintenance", "critical", "success"],
      default: "info",
    },
    cta_label: { type: String, default: null },
    cta_url: { type: String, default: null },
    dismissible: { type: Boolean, default: true },
    is_active: { type: Boolean, default: true, index: true },
    sort_order: { type: Number, default: 0, index: true },
    start_date: { type: Date, default: null },
    end_date: { type: Date, default: null },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
  },
  { timestamps: true }
);

homeBannerSchema.index({ is_active: 1, sort_order: 1 });
homeBannerSchema.index({ audience: 1, is_active: 1 });

const HomeBanner = Model(Tables.home_banner, homeBannerSchema);
export default HomeBanner;
