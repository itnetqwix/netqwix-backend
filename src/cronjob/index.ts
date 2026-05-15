import * as cron from "node-cron";
import {
  AccountType,
  BOOKED_SESSIONS_STATUS,
  NetquixImage,
  SessionReminderMinutes,
} from "../config/constance";
import { PipelineStage } from "mongoose";
import booked_session from "../model/booked_sessions.schema";
import user from "../model/user.schema";
import notification from "../model/notifications.schema";
import { Utils } from "../Utils/Utils";
import { SendEmail } from "../Utils/sendEmail";
import onlineUser from "../model/online_user.schema";
import { NotificationsService } from "../modules/notifications/notificationsService";
import { AIService } from "../services/ai-service";
import { NotificationType } from "../enum/notification.enum";

const pushService = new NotificationsService();
const aiService = new AIService();

  export const cronjobs = async () => {
    const job = cron.schedule("* * * * *", () => {
      try {
        meetingConfirmationJob();
        cleanupInactiveUsers();
      } catch (err) {
        console.log("err on cron job running", err);
      }
    });
    await job.start();

    // Smart re-engagement: daily at 10 AM
    const reEngagementJob = cron.schedule("0 10 * * *", () => {
      try {
        smartReEngagementJob();
      } catch (err) {
        console.log("err on smart re-engagement job:", err);
      }
    });
    await reEngagementJob.start();
  };

const meetingConfirmationJob = async () => {
  try {
    const currentHourAndMinute = Utils.getCurrentHourAndMinute();
    const { currentDateTime, currentHour, currentMinute } =
    currentHourAndMinute;
    const formattedDate = Utils.formatDateTime(currentDateTime);
    const formattedDateTime = Utils.formatDateWithTimeStamp(formattedDate);
    await processBookedSessions(formattedDateTime, currentHour, currentMinute);
  } catch (err) {
    console.log("Error on cron job run", err);
  }
};

const processBookedSessions = async (
  formattedDateTime,
  currentHour,
  currentMinute
) => {
  const targetTime = Utils.formatTime(currentHour, currentMinute);
  const booked_date = new Date(formattedDateTime);
  const pipeline: PipelineStage[] = [
    {
      $match: {
        status: BOOKED_SESSIONS_STATUS.confirm,
        booked_date: booked_date,
        session_start_time: targetTime,
      },
    },
    {
      $lookup: {
        from: "users",
        let: {
          trainerid: "$trainer_id",
          traineeid: "$trainee_id",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$_id", "$$trainerid"] },
                  { $eq: ["$_id", "$$traineeid"] },
                ],
              },
            },
          },
        ],
        as: "userDetails",
      },
    },
  ];
  const matchedSessions = await booked_session.aggregate(pipeline);
  sendSessionReminderEmails(matchedSessions);
  sendSessionPushReminders(matchedSessions);
};

const sendSessionReminderEmails = (matchedSessions: any[]) => {
  const sessionReminders = matchedSessions.map((session) => {
    const { userDetails } = session;
    const formateSessionStartTime = Utils.convertToAmPm(
      session.session_start_time
    );
    const formateSessionEndTime = Utils.convertToAmPm(session.session_end_time);
    const bookedTime = `${formateSessionStartTime} To ${formateSessionEndTime}`;
    const bookedDate = session.booked_date;
    const formateBookedDate = Utils.formattedDateMonthDateYear(bookedDate);
    const trainees = userDetails.filter((user) =>
      user.account_type.includes(AccountType.Trainee)
    );
    trainees.forEach((traineeUser) => {
      const { email, fullname,notifications } = traineeUser;
      if(notifications.promotional.email){
      SendEmail.sendRawEmail(
        null,
        null,
        [email],
        `REMINDER: Your NetQwix Training Session Starts in ${SessionReminderMinutes.FIFTEEN} minutes at ${bookedTime}`,
        null,
        `<div style="font-family: Verdana,Arial,Helvetica,sans-serif;font-size: 18px;line-height: 30px;">
      <i  style='color:#ff0000'>${fullname},</i>
      <br/><br/>
      This is your ${SessionReminderMinutes.FIFTEEN} minute reminder that your Training Session will begin in ${SessionReminderMinutes.FIFTEEN} minutes.
      ${formateBookedDate} ${bookedTime} EST
      <br/><br/>
      Team NetQwix recommends logging in 2-5 minutes prior to your scheduled session.<br/><br/>
      Thank You For Booking the Slot in NetQwix.
      <br/><br/>
      From,  <br/>
      NetQwix Team. <br/>
      <img src=${NetquixImage.logo} style="object-fit: contain; width: 180px;"/>
       </div> `
      );}
    });
  });
  return sessionReminders;
};

function sendSessionPushReminders(matchedSessions: any[]) {
  for (const session of matchedSessions) {
    const { userDetails } = session;
    if (!userDetails?.length) continue;
    const startTime = Utils.convertToAmPm(session.session_start_time);
    for (const u of userDetails) {
      void pushService.sendPushNotification(
        String(u._id),
        "Session Reminder",
        `Your session starts at ${startTime}. Get ready!`,
        { kind: "session_reminder", sessionId: String(session._id) }
      );
    }
  }
}

async function cleanupInactiveUsers() {
  const inactiveThresholdHours = 2; 
  const inactiveThreshold = inactiveThresholdHours * 60 * 60 * 1000;

  try {
    await onlineUser.deleteMany({
      last_activity_time: { $lt: Date.now() - inactiveThreshold },
    });
  } catch (error) {
    console.error('Error cleaning up inactive users:', error);
  }
}

async function smartReEngagementJob() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Trainees who haven't booked in 7-30 days
    const recentBookers = await booked_session.distinct("trainee_id", {
      createdAt: { $gte: sevenDaysAgo },
    });

    const inactiveTrainees = await user
      .find({
        account_type: "Trainee",
        status: "approved",
        _id: { $nin: recentBookers },
        createdAt: { $lt: sevenDaysAgo, $gt: thirtyDaysAgo },
        "notifications.promotional.email": { $ne: false },
      })
      .select("_id fullname category")
      .limit(50)
      .lean();

    for (const trainee of inactiveTrainees) {
      const t = trainee as any;
      const lastSession = await booked_session
        .findOne({ trainee_id: t._id, status: "completed" })
        .sort({ createdAt: -1 })
        .populate("trainer_id", "fullname")
        .lean();

      const daysSince = lastSession
        ? Math.floor((Date.now() - new Date((lastSession as any).createdAt).getTime()) / 86400000)
        : 14;

      try {
        const content = await aiService.generateNotificationContent({
          userType: "Trainee",
          userName: t.fullname,
          daysSinceLastBooking: daysSince,
          category: t.category,
          lastTrainer: (lastSession as any)?.trainer_id?.fullname,
        });

        await notification.create({
          title: content.title,
          description: content.body,
          receiverId: t._id,
          type: NotificationType.PROMOTIONAL,
        });

        void pushService.sendPushNotification(
          String(t._id),
          content.title,
          content.body,
          { kind: "re_engagement" }
        );
      } catch (aiErr) {
        // Non-fatal: skip this user if AI fails
      }
    }

    console.log(`[SmartReEngagement] Processed ${inactiveTrainees.length} inactive trainees.`);
  } catch (err) {
    console.error("[SmartReEngagement] Error:", err);
  }
}
