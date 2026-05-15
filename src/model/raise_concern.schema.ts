import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const raiseConcernSchema: Schema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        booking_id: {
            type: Schema.Types.ObjectId,
            ref: "booked_sessions",
            default: null,
        },
        reported_user_id: {
            type: Schema.Types.ObjectId,
            ref: "user",
            default: null,
        },
        name: {
            type: String,
        },
        email: {
            type: String,
        },
        phone_number: {
            type: String,
        },
        reason: {
            type: String,
        },
        is_releted_to_refund: {
            type: String,
        },
        description: {
            type: String,
        },
        subject: {
            type: String,
        },
        ticket_status: {
            type: String,
            default : "open"
        },
    },
    { timestamps: true }
);

const raise_concern = Model(
    Tables.raise_concern,
    raiseConcernSchema
);
export default raise_concern;
