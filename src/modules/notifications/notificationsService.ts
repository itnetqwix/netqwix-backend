import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import * as webpush from 'web-push';
import notification from "../../model/notifications.schema";
import mongoose from "mongoose";
import user from "../../model/user.schema";



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
}