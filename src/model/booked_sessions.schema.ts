import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";
import { BOOKED_SESSIONS_STATUS } from "../config/constance";

const bookedSessionsSchema: Schema = new Schema(
    {
        trainer_id: {
            type: Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
        trainee_id: {
            type: Schema.Types.ObjectId,
            ref: "users",
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

    },
    { timestamps: true }
);

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
