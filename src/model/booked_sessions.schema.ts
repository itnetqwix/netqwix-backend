import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";

/** Only set on the booking after a refund is initiated — omit on new bookings. */
const refundTransferSchema = new Schema(
    {
        destination: {
            type: String,
            enum: ["wallet", "card", "bank"],
            required: true,
        },
        status: {
            type: String,
            enum: ["pending", "processing", "completed", "failed"],
            required: true,
        },
        amount_minor: { type: Number },
        initiated_at: { type: Date },
        expected_by: { type: Date },
        completed_at: { type: Date, default: null },
        stripe_refund_id: { type: String, default: null },
        payout_request_id: {
            type: Schema.Types.ObjectId,
            ref: Tables.payout_requests,
            default: null,
        },
        failure_reason: { type: String, default: null },
    },
    { _id: false }
);

const bookedSessionsSchema: Schema = new Schema(
    {
        trainer_id: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        trainee_id: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        status: {
            type: String,
            default: null,
            enum: BOOKED_SESSIONS_STATUS,
        },
        booked_date: {
            type: Date,
            default: null,
            required: true,
        },
        session_start_time: {
            type: String,
            default: null,
            required: true,
        },
        session_end_time: {
            type: String,
            default: null,
            required: true,
        },
        start_time: {
            type: Date,
            default: null,
        },
        end_time: {
            type: Date,
            default: null,
        },
        time_zone: {
            type: String,
            default: null,
        },
        session_link: {
            type: String,
            default: null,
        },
        ratings: {
            type: Object,
            default: null,
        },
        report: {
            type: String,
            default: null,
        },
        /** Trainee messaging: coach may publish game plan by this time after lesson end. */
        game_plan_expected_at: {
            type: Date,
            default: null,
        },
        report_file_size_bytes: {
            type: Number,
            default: 0,
        },
        payment_intent_id: {
            type: String,
            default: null,
        },
        trainee_clip: [{
            type: Schema.Types.ObjectId,
            ref: "clip"
        }],
        refund_status: {
            type: String,
        },
        amount: {
            type: String,
        },
        application_fee_amount: {
            type: String,
        },
        iceServers: {
            type: Schema.Types.Array,
            default: [],              
        },
        extended_session_end_time:{
            type: String,
            default: null,
        },
        extended_end_time:{
            type: Date,
            default: null,
        },
        /** True when the booking was created via instant lesson flow (trainer UI uses Stop, not Pause). */
        is_instant: {
            type: Boolean,
            default: false,
        },
        /** When the trainer confirmed an instant lesson (join window starts here). */
        accepted_at: {
            type: Date,
            default: null,
        },
        /** Lesson length in minutes (instant: 15 or 30). */
        duration_minutes: {
            type: Number,
            default: null,
        },
        /** Instant lifecycle phase (server-authoritative). */
        instant_phase: {
            type: String,
            enum: [
                "pending_accept",
                "pending_join",
                "active",
                "completed",
                "cancelled",
            ],
            default: null,
        },
        requested_at: {
            type: Date,
            default: null,
        },
        accept_deadline_at: {
            type: Date,
            default: null,
        },
        join_deadline_at: {
            type: Date,
            default: null,
        },
        both_joined_at: {
            type: Date,
            default: null,
        },
        refund_reason: {
            type: String,
            default: null,
        },
        coupon_code: {
            type: String,
            default: null,
        },
        discount_applied: {
            type: Number,
            default: 0,
        },
        /** Referral first-lesson checkout discount (USD); stacks with coupon_code. */
        referral_discount_applied: {
            type: Number,
            default: 0,
        },
        original_amount: {
            type: String,
            default: null,
        },
        total_extended_minutes: {
            type: Number,
            default: 0,
        },
        extensions: [
            {
                minutes: { type: Number, required: true },
                amount: { type: Number, required: true },
                payment_intent_id: { type: String, default: null },
                status: {
                    type: String,
                    enum: ["pending", "applied", "failed", "refunded"],
                    default: "pending",
                },
                requested_at: { type: Date, default: Date.now },
                applied_at: { type: Date, default: null },
                requested_by: { type: Schema.Types.ObjectId, ref: "user" },
            },
        ],
        /**
         * Live trainer-approval workflow for paid extensions. A trainee's request
         * lives here from "pending" -> "accepted" -> "paid"; an entry that ends as
         * "paid" is mirrored into `extensions[]` once the timer is applied.
         */
        extension_requests: [
            {
                minutes: { type: Number, required: true },
                amount: { type: Number, required: true },
                status: {
                    type: String,
                    enum: [
                        "pending",
                        "accepted",
                        "rejected",
                        "paid",
                        "cancelled",
                        "expired",
                    ],
                    default: "pending",
                },
                requested_by: { type: Schema.Types.ObjectId, ref: "user" },
                requested_at: { type: Date, default: Date.now },
                decided_by: { type: Schema.Types.ObjectId, ref: "user", default: null },
                decided_at: { type: Date, default: null },
                expires_at: { type: Date, default: null },
                payment_intent_id: { type: String, default: null },
                /** Index into `extensions[]` once the request is fully applied. */
                extension_index: { type: Number, default: null },
                /** Free-text terminal reason (e.g. "trainer_offline_timeout"). */
                terminal_reason: { type: String, default: null },
            },
        ],
        /** Refund payout timeline (wallet / card / bank) for trainee visibility. */
        refund_transfer: {
            type: refundTransferSchema,
            required: false,
        },
        /** Timestamped trainer notes captured during a live lesson. */
        session_live_notes: [
            {
                text: { type: String, required: true },
                author_id: { type: Schema.Types.ObjectId, ref: "user" },
                elapsed_seconds: { type: Number, default: 0 },
                shared_with_trainee: { type: Boolean, default: false },
                created_at: { type: Date, default: Date.now },
            },
        ],
        /** Last clip the trainer focused for the trainee during the session. */
        focused_clip_id: {
            type: Schema.Types.ObjectId,
            ref: "clip",
            default: null,
        },
    },
    { timestamps: true }
);

bookedSessionsSchema.index(
    { "extensions.payment_intent_id": 1 },
    { sparse: true }
);
bookedSessionsSchema.index(
    { "extension_requests.payment_intent_id": 1 },
    { sparse: true }
);
bookedSessionsSchema.index({ "extension_requests.status": 1, "extension_requests.expires_at": 1 });

// Add indexes for performance optimization
bookedSessionsSchema.index({ createdAt: -1 }); // For sorting by creation date
bookedSessionsSchema.index({ status: 1 }); // For filtering by status
bookedSessionsSchema.index({ trainer_id: 1 }); // For trainer lookups
bookedSessionsSchema.index({ trainee_id: 1 }); // For trainee lookups
bookedSessionsSchema.index({ booked_date: 1 }); // For date filtering
bookedSessionsSchema.index({ trainer_id: 1, status: 1, booked_date: 1 }); // Compound index for common queries
bookedSessionsSchema.index({ trainee_id: 1, status: 1, booked_date: 1 }); // Compound index for common queries

const booked_session = Model(
    Tables.booked_sessions,
    bookedSessionsSchema
);
export default booked_session;
