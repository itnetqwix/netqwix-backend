import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const promoCodeSchema: Schema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    description: { type: String, default: "" },
    discount_type: {
      type: String,
      enum: ["percentage", "fixed_amount"],
      required: true,
    },
    discount_value: { type: Number, required: true, min: 0 },
    min_order_amount: { type: Number, default: 0, min: 0 },
    max_discount_amount: { type: Number, default: 0, min: 0 },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    usage_limit: { type: Number, default: 0, min: 0 },
    usage_count: { type: Number, default: 0, min: 0 },
    per_user_limit: { type: Number, default: 0, min: 0 },
    applicable_user_types: {
      type: [String],
      enum: ["Trainee", "Trainer", "All"],
      default: ["All"],
    },
    applicable_booking_types: {
      type: [String],
      enum: ["instant", "scheduled", "all"],
      default: ["all"],
    },
    applicable_locations: { type: [String], default: [] },
    is_active: { type: Boolean, default: true },
    is_visible: { type: Boolean, default: false },
    display_label: { type: String, default: "" },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      default: null,
    },
    used_by: [
      {
        user_id: { type: Schema.Types.ObjectId, ref: Tables.user },
        used_at: { type: Date, default: Date.now },
        booking_id: {
          type: Schema.Types.ObjectId,
          ref: Tables.booked_sessions,
        },
        discount_applied: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

promoCodeSchema.index({ is_active: 1, start_date: 1, end_date: 1 });
promoCodeSchema.index({ is_visible: 1, is_active: 1 });

export default Model(Tables.promo_code, promoCodeSchema);
