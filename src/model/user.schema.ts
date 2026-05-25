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
    /** When the user accepted Terms & Conditions and Privacy Policy (signup). */
    terms_and_privacy_accepted_at: {
      type: Date,
      default: null,
    },
    friends: [{ type: ObjectId, ref: 'user' }],
    blockedUsers: [{ type: ObjectId, ref: 'user' }],
    lastSeen: { type: Date, default: null },
    /** Base64 Curve25519 public key for E2E chat (NaCl box). */
    chat_public_key: { type: String, default: null },
    /** When false, trainer stays hidden from online lists even if socket is connected. */
    showAsOnline: { type: Boolean, default: true },
    /**
     * When TRUE (default), instant booking requests that fall outside the
     * trainer's weekly availability template are auto-declined before they
     * ever ping the trainer's device. Trainers can flip this OFF if they
     * want to be reachable for ad-hoc instant lessons 24/7.
     */
    auto_decline_outside_business_hours: { type: Boolean, default: true },
    /**
     * Privacy preferences. We currently only need read-receipt opt-out
     * (mirrors WhatsApp's switch — when off the sender no longer sees
     * blue ticks from this user).
     */
    privacy: {
      read_receipts_enabled: { type: Boolean, default: true },
    },
    /**
     * Profile-visibility settings surfaced in the privacy screen. Defaults
     * preserve current behaviour: last-active and search visibility on,
     * message requests from non-friends allowed.
     */
    privacy_visibility: {
      show_last_active: { type: Boolean, default: true },
      show_in_community_search: { type: Boolean, default: true },
      allow_message_requests_from_non_friends: { type: Boolean, default: true },
      show_online_status: { type: Boolean, default: true },
    },
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
      /**
       * Cadence preset for upcoming-session push reminders.
       *
       *  - `standard`  → 24h + 1h + 10m before the session
       *  - `minimal`   → 1h only
       *  - `aggressive`→ 24h + 1h + 10m + 1m
       *  - `off`       → no reminder pushes
       */
      bookingReminderCadence: {
        type: String,
        enum: ["standard", "minimal", "aggressive", "off"],
        default: "standard",
      },
      /**
       * Per-category × per-channel switches. Each category (messages /
       * bookings / payments / marketing) can be independently enabled on
       * push, email, and SMS. Read in `NotificationsService` *before*
       * dispatching anything — when the user opts out, we skip silently.
       *
       * Booleans, no enums: lets us add new channels without a migration.
       */
      channels: {
        messages: {
          push: { type: Boolean, default: true },
          email: { type: Boolean, default: false },
          sms: { type: Boolean, default: false },
        },
        bookings: {
          push: { type: Boolean, default: true },
          email: { type: Boolean, default: true },
          sms: { type: Boolean, default: true },
        },
        payments: {
          push: { type: Boolean, default: true },
          email: { type: Boolean, default: true },
          sms: { type: Boolean, default: false },
        },
        marketing: {
          push: { type: Boolean, default: true },
          email: { type: Boolean, default: true },
          sms: { type: Boolean, default: false },
        },
      },
      /**
       * "Mute notifications until …" — when set in the future every push
       * delivery is suppressed regardless of channel switches. Cleared
       * by the user or auto-cleared once we pass it.
       */
      mute_until: { type: Date, default: null },
      /**
       * Quiet hours window — both `start_minutes` and `end_minutes` are
       * minutes-since-midnight in the user's `timezone`. When `enabled`
       * we skip non-urgent pushes/SMS that arrive inside the window and
       * defer them to the next morning (handled in the dispatcher).
       *
       * Categories listed in `urgent_categories` always punch through.
       */
      quiet_hours: {
        enabled: { type: Boolean, default: false },
        start_minutes: { type: Number, default: 22 * 60 },
        end_minutes: { type: Number, default: 7 * 60 },
        timezone: { type: String, default: "UTC" },
        urgent_categories: {
          type: [String],
          default: ["instant_lesson", "session_starting"],
        },
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
    /**
     * Bumped when a freshly signed-up user's guest browsing activity has been
     * ingested via `POST /trainee/guest-activity`. Lets the discovery feed
     * cheaply detect whether seeded recommendations are available.
     */
    guest_seed_ingested_at: {
      type: Date,
      default: null,
    },
    /**
     * Self-serve account deletion (App Store / Play Store compliance).
     * When set, the user is treated as deleted everywhere: cannot log in,
     * hidden from listings, frozen from receiving messages. A cleanup job
     * can hard-delete after a 30-day grace period.
     */
    deleted_at: { type: Date, default: null, index: true },
    deletion_reason: { type: String, default: null },
    /** IANA zone (e.g. America/New_York) for availability display and scheduling context. */
    time_zone: {
      type: String,
      default: "America/New_York",
    },
    /** BCP 47 language tag for app UI (e.g. en, es). */
    preferred_locale: {
      type: String,
      default: "en",
    },
    storage_plan: {
      type: String,
      enum: ["free", "plus_5gb", "pro_10gb", "max_25gb"],
      default: "free",
    },
    storage_quota_bytes: {
      type: Number,
      default: 2 * 1024 * 1024 * 1024,
    },
    storage_used_bytes: {
      type: Number,
      default: 0,
    },
    storage_stripe_subscription_id: {
      type: String,
      default: null,
    },
    storage_billing_interval: {
      type: String,
      enum: ["monthly", "yearly", "one_time", null],
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    account_rejection_reason: {
      type: String,
      default: null,
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