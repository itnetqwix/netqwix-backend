import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Admin-driven tips system (Phase 2 item 5).
 *
 * Tips render as a horizontal carousel on the mobile home screen. Admins
 * can target by audience (`all` / `trainer` / `trainee`), schedule with
 * `start_date` / `end_date`, and reorder via `sort_order`.
 */
const tipSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    body: { type: String, required: true, trim: true, maxlength: 600 },
    image_url: { type: String, default: null },
    icon: { type: String, default: null }, // optional Ionicon name for icon-only tips
    audience: {
      type: String,
      enum: ["all", "trainer", "trainee", "guest"],
      default: "all",
      index: true,
    },
    cta_label: { type: String, default: null },
    cta_url: { type: String, default: null }, // mobile deep-link, e.g. "netqwix://wallet" or https URL
    sort_order: { type: Number, default: 0, index: true },
    is_active: { type: Boolean, default: true, index: true },
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

tipSchema.index({ is_active: 1, audience: 1, sort_order: 1 });

const Tip = Model(Tables.tip, tipSchema);
export default Tip;
