import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import { AccountType, LoginType } from "../modules/auth/authEnum";
import { ObjectId } from "mongodb";

const userSchema: Schema = new Schema(
  {
    fullname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
      select: false, // This line excludes password from toJSON output
    },
    mobile_no: {
      type: String,
    },
    account_type: {
      type: String,
      enum: AccountType,
    },
    login_type: {
      type: String,
      enum: LoginType,
      default: LoginType.DEFAULT,
    },
    profile_picture: {
      type: String,
      // default: "https://netquix-ui.vercel.app/user.jpg",
    },
    category: {
      type: String,
    },
    wallet_amount: {
      type: Number,
      default: 0,
    },
    extraInfo: {
      type: Object,
      default: {},
    },
    commission: {
      type: String,
    },
    is_registered_with_stript: { type: Boolean, default: false },
    is_kyc_completed: { type: Boolean, default: false },
    stripe_account_id: {
      type: String,
    },
    subscriptionId: {
      type: String,
      default: null
    },
    isPrivate: {
      type: Boolean,
      default: false, // Default to false so users appear in search by default
    },
    friends: [{ type: ObjectId, ref: 'user' }],
    blockedUsers: [{ type: ObjectId, ref: 'user' }],
    lastSeen: { type: Date, default: null },
    /** Base64 Curve25519 public key for E2E chat (NaCl box). */
    chat_public_key: { type: String, default: null },
    /** When false, trainer stays hidden from online lists even if socket is connected. */
    showAsOnline: { type: Boolean, default: true },
    friendRequests: [
      {
        senderId: { type: Schema.Types.ObjectId, ref: 'user' },
        receiverId: { type: Schema.Types.ObjectId, ref: 'user' },
      },
    ],
    notifications: {
      promotional: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
      },
      transactional: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
      },
    },
    interests: {
      type: [String],
      default: [],
    },
    ai_profile_summary: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    trainer_verification: {
      onboarding_step: {
        type: String,
        enum: [
          "account_created",
          "contact_verified",
          "profile_face_complete",
          "under_review",
          "completed",
        ],
        default: "account_created",
      },
      email_verified_at: { type: Date },
      phone_verified_at: { type: Date },
      profile_completed_at: { type: Date },
      face: {
        rekognition_session_id: String,
        confidence: Number,
        liveness_status: String,
        reference_image_s3_key: String,
        submitted_at: Date,
      },
      submitted_for_review_at: { type: Date },
      review_escalated_at: { type: Date },
      rejection_reason: { type: String },
      grace_deadline: { type: Date },
      version: { type: Number, default: 1 },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', function (next) {
  if (!this.notifications) {
    this.notifications = {
      promotional: { email: true, sms: true },
      transactional: { email: true, sms: true },
    };
  }
  next();
});

// Add the toJSON method to the schema
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const user = Model(Tables.user, userSchema);
export default user;