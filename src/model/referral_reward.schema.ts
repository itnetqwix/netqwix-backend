import { Document, Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import type { ReferralBeneficiary, ReferralRewardTrigger } from "../config/referral";

export type ReferralRewardStatus = "credited" | "skipped" | "failed";

export interface IReferralReward extends Document {
  attribution_id: Schema.Types.ObjectId;
  beneficiary_user_id: Schema.Types.ObjectId;
  beneficiary_role: ReferralBeneficiary;
  trigger: ReferralRewardTrigger;
  amount_minor: number;
  currency: string;
  status: ReferralRewardStatus;
  idempotency_key: string;
  booking_id?: Schema.Types.ObjectId;
  skip_reason?: string;
  ledger_entry_ids?: string[];
  createdAt?: Date;
}

const referralRewardSchema = new Schema(
  {
    attribution_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.referral_attribution,
      required: true,
      index: true,
    },
    beneficiary_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    beneficiary_role: { type: String, enum: ["referrer", "referee"], required: true },
    trigger: { type: String, enum: ["signup", "first_booking"], required: true },
    amount_minor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: ["credited", "skipped", "failed"],
      default: "skipped",
    },
    idempotency_key: { type: String, required: true, unique: true },
    booking_id: { type: Schema.Types.ObjectId, ref: Tables.booked_sessions },
    skip_reason: { type: String },
    ledger_entry_ids: [{ type: String }],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const ReferralReward = Model<IReferralReward>(Tables.referral_reward, referralRewardSchema);
export default ReferralReward;
