import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const writeUSSchema: Schema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
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
        // reason: {
        //     type: String,
        // },
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

const write_us = Model(
    Tables.write_us,
    writeUSSchema
);
export default write_us;
