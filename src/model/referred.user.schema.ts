import { Document, Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

// Define the interface for ReferredUser
export interface IReferredUser extends Document {
  email: string;
  referrerId: Schema.Types.ObjectId; // Reference to the User model
  createdAt?: Date; // Optional, can be included with timestamps
  updatedAt?: Date; // Optional, can be included with timestamps
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
      ref: Tables.user, // Reference to the User model
      required: true 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
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
