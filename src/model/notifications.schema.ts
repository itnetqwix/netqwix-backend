import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";
import { NotificationType } from "../enum/notification.enum";

const notificationSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    receiverId: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    status: {
      type: Boolean,
      default: true,
    },
    type: {
      type: String,
      enum: NotificationType,
      default: NotificationType.DEFAULT
    }
  },
  { timestamps: true }
);

const notification = Model(Tables.notifications, notificationSchema);
export default notification;
