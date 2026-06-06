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

// Primary access pattern: fetch unread by receiver, newest first
notificationSchema.index({ receiverId: 1, isRead: 1, createdAt: -1 });
// Auto-delete notifications older than 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const notification = Model(Tables.notifications, notificationSchema);
export default notification;
