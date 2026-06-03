import { Document, Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import { AccountType } from "../modules/auth/authEnum";

export interface IReferralAttribution extends Document {
  referrer_user_id: Schema.Types.ObjectId;
  referee_user_id: Schema.Types.ObjectId;
  referrer_account_type: AccountType;
  referee_account_type: AccountType;
  invite_id?: Schema.Types.ObjectId;
  referral_code?: string;
  signup_rewards_settled: boolean;
  first_booking_reward_settled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const referralAttributionSchema = new Schema(
  {
    referrer_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    referee_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      unique: true,
    },
    referrer_account_type: {
      type: String,
      enum: [AccountType.TRAINER, AccountType.TRAINEE],
      required: true,
    },
    referee_account_type: {
      type: String,
      enum: [AccountType.TRAINER, AccountType.TRAINEE],
      required: true,
    },
    invite_id: { type: Schema.Types.ObjectId, ref: Tables.referredUser },
    referral_code: { type: String },
    signup_rewards_settled: { type: Boolean, default: false },
    first_booking_reward_settled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

referralAttributionSchema.index({ referrer_user_id: 1, createdAt: -1 });

const ReferralAttribution = Model<IReferralAttribution>(
  Tables.referral_attribution,
  referralAttributionSchema
);
export default ReferralAttribution;
