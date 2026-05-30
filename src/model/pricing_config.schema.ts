import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const paymentMethodFeeSchema = new Schema(
  { bps: Number, fixedMinor: Number },
  { _id: false }
);

const regionSchema = new Schema(
  {
    currency: String,
    traineePlatformFeeMinor: Number,
    trainerPlatformFeeMinor: Number,
    defaultCommissionRate: Number,
    minCommissionRateFloor: Number,
    passProcessingFeeToTrainee: Boolean,
    paymentMethodFees: { type: Map, of: paymentMethodFeeSchema },
    storagePlans: Schema.Types.Mixed,
    stripeTaxEnabled: Boolean,
    cogsMinor: Schema.Types.Mixed,
  },
  { _id: false }
);

const pricingConfigSchema = new Schema(
  {
    version: { type: Number, required: true },
    is_active: { type: Boolean, default: false, index: true },
    effective_at: { type: Date, default: Date.now },
    quote_tolerance_minor: { type: Number, default: 5 },
    regions: {
      US: regionSchema,
      CA: regionSchema,
    },
    product_fees: Schema.Types.Mixed,
    updated_by_admin_id: { type: Schema.Types.ObjectId, ref: "user" },
  },
  { timestamps: true }
);

export default Model(Tables.pricing_config, pricingConfigSchema);
