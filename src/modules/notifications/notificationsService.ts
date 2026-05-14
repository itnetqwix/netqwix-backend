import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import * as webpush from 'web-push';
import notification from "../../model/notifications.schema";
import mongoose from "mongoose";
import user from "../../model/user.schema";
import push_token from "../../model/push_token.schema";



//NOTE -  Set VAPID details
webpush.setVapidDetails(
    'mailto:example@yourdomain.org',
    process.env.WEB_PUSH_PUBLIC_KEY,
    process.env.WEB_PUSH_PRIVATE_KEY

  );
export class NotificationsService {

  public async getPublicKey(): Promise<ResponseBuilder> {
    try{
      return ResponseBuilder.data({publicKey : process.env.WEB_PUSH_PUBLIC_KEY}, l10n.t("Web Push Public key"));
    }
    catch(error){
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getSubscription(req: any): Promise<ResponseBuilder> {
    try{
         const userId = req?.authUser?._id ;
         const {subscription} = req?.body ;
         await user.findByIdAndUpdate(userId , {$set : {subscriptionId : JSON.stringify(subscription)}}) ;
         return ResponseBuilder.successMessage("Subscription Id Updated successfully");
    }
    catch(error){
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
    public async getNotifications(req : any): Promise<ResponseBuilder> {
      try{
          const userId = req?.authUser?._id;
          const {page , limit} = req?.query ;
        const notifications = await notification.find(
            {
                receiverId : userId
            }
        )
        .populate('senderId')
        .sort({createdAt : -1})
        .skip(parseInt(limit) * (parseInt(page) - 1))
        .limit(parseInt(limit));
        const data =  notifications?.map((notification) =>{
            return {
                _id : notification?._id ,
                title : notification?.title,
                description : notification?.description,
                createdAt : notification?.createdAt,
                isRead : notification?.isRead,
                sender : {
                    _id : notification?.senderId?._id,
                    name : notification?.senderId?.fullname,
                    profile_picture : notification?.senderId?.profile_picture || null
                }
            }
        })
        return ResponseBuilder.data(data, l10n.t("Get All Notifications"));
    }
    catch(error){
        console.error("Error getting notifications:", error);
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
    public async updateNotificationsStatus(req : any): Promise<ResponseBuilder> {
      try{
          const userId = req?.authUser?._id;
          const {page} = req?.body ;

          const notifications = await notification.find({
            receiverId: userId,
            isRead: false
          })
          .sort({ createdAt: -1 }) 
          .limit(10)
          .skip((page - 1) * 10)
          
          const notificationIds = notifications?.map(notif => notif._id) || [];
          
          await notification.updateMany(
            { _id: { $in: notificationIds } },
            { $set: { isRead: true } }
          );
          return ResponseBuilder.successMessage("Notification Status Updated successfully");
    }
    catch(error){
        console.error("Error updating notification status:", error);
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async registerPushToken(userId: string, token: string, platform: string, deviceId: string, kind: string): Promise<ResponseBuilder> {
    try {
      if (!token || !deviceId) {
        return ResponseBuilder.badRequest("token and deviceId are required");
      }
      await push_token.findOneAndUpdate(
        { deviceId },
        { userId, token, platform: platform || "android", kind: kind || "expo", updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return ResponseBuilder.successMessage("Push token registered");
    } catch (error) {
      console.error("Error registering push token:", error);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async unregisterPushToken(deviceId: string): Promise<ResponseBuilder> {
    try {
      if (!deviceId) return ResponseBuilder.badRequest("deviceId is required");
      await push_token.deleteMany({ deviceId });
      return ResponseBuilder.successMessage("Push token unregistered");
    } catch (error) {
      console.error("Error unregistering push token:", error);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    try {
      const tokens = await push_token.find({ userId }).lean();
      if (!tokens.length) return;

      const messages = tokens.map((t: any) => ({
        to: t.token,
        sound: "default" as const,
        title,
        body,
        data: data || {},
        channelId: "lessons",
      }));

      const batchSize = 100;
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        try {
          const res = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          });
          if (!res.ok) {
            console.error("[PushNotification] Expo API error:", res.status, await res.text());
          }
        } catch (fetchErr) {
          console.error("[PushNotification] Fetch error:", fetchErr);
        }
      }
    } catch (err) {
      console.error("[PushNotification] Error:", err);
    }
  }
}