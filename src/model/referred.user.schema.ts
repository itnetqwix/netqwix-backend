import { Document, Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import { AccountType } from "../modules/auth/authEnum";

export type ReferralInviteStatus = "pending" | "registered" | "qualified";

// Define the interface for ReferredUser
export interface IReferredUser extends Document {
  email: string;
  referrerId: Schema.Types.ObjectId;
  /** Account type the invitee is encouraged to register as. */
  target_account_type?: AccountType;
  status?: ReferralInviteStatus;
  registered_user_id?: Schema.Types.ObjectId;
  referral_code?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Create the referred user schema
const referredUserSchema: Schema = new Schema(
  {
    email: { 
      type: String, 
      required: true, 
      unique: true 
    },
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    target_account_type: {
      type: String,
      enum: [AccountType.TRAINER, AccountType.TRAINEE],
      default: AccountType.TRAINEE,
    },
    status: {
      type: String,
      enum: ["pending", "registered", "qualified"],
      default: "pending",
    },
    registered_user_id: { type: Schema.Types.ObjectId, ref: Tables.user },
    referral_code: { type: String },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt timestamps
);

// Define the toJSON method if needed
referredUserSchema.methods.toJSON = function () {
  const referredUserObject = this.toObject();
  return referredUserObject;
};

// Create the model using the IReferredUser interface
const ReferredUser = Model<IReferredUser>(Tables.referredUser, referredUserSchema);
export default ReferredUser;
