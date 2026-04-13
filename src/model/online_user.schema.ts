import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const onlineUserSchema: Schema = new Schema(
    {
        trainer_id: { type: Schema.Types.ObjectId, ref: "users",unique:true },
        last_activity_time: { type: Date },
    },
    { timestamps: true }
);

const onlineUser = Model(Tables.online_user, onlineUserSchema);
export default onlineUser;