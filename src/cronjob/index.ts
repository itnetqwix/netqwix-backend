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
import { isBullmqAvailable } from "../queues/bullmqConnection";

const pushService = new NotificationsService();
const aiService = new AIService();

  export const cronjobs = async () => {
    const useBullmqReminders =
      isBullmqAvailable() &&
      String(process.env.BULLMQ_BOOKING_REMINDERS ?? "true").toLowerCase() !== "false";

    // Booking confirmation reminders (1-min granularity required for scheduling accuracy)
    const job = cron.schedule("* * * * *", () => {
      try {
        if (!useBullmqReminders) {
          meetingConfirmationJob();
        }
      } catch (err) {
        console.log("err on cron job running", err);
      }
    });
    await job.start();

    // Online-user cleanup — runs every 5 min (was every 1 min; 5 min is sufficient)
    const cleanupJob = cron.schedule("*/5 * * * *", () => {
      try {
        cleanupInactiveUsers();
      } catch (err) {
        console.log("err on cleanup job running", err);
      }
    });
    await cleanupJob.start();

    // Smart re-engagement: daily at 10 AM
    const reEngagementJob = cron.schedule("0 10 * * *", () => {
      try {
        smartReEngagementJob();
      } catch (err) {
        console.log("err on smart re-engagement job:", err);
      }
    });
    await reEngagementJob.start();

    const escrowReleaseJob = cron.schedule("*/15 * * * *", () => {
      try {
        const { releaseService } = require("../modules/wallet/releaseService");
        void releaseService.processEligibleHolds();
      } catch (err) {
        console.log("err on escrow release job:", err);
      }
    });
    void escrowReleaseJob.start();

    const verificationSlaJob = cron.schedule("0 * * * *", () => {
      try {
        const { trainerReviewService } = require("../modules/verification/trainerReviewService");
        void trainerReviewService.processSlaEscalations();
      } catch (err) {
        console.log("err on verification SLA job:", err);
      }
    });
    void verificationSlaJob.start();

    const instantRefundJob = cron.schedule("*/5 * * * *", () => {
      try {
        const {
          processPendingInstantRefunds,
        } = require("../modules/wallet/instantLessonRefundService");
        void processPendingInstantRefunds();
      } catch (err) {
        console.log("err on instant refund job:", err);
      }
    });
    void instantRefundJob.start();

    const scheduledNoShowJob = cron.schedule("*/5 * * * *", () => {
      try {
        const { processScheduledNoShowRefunds } = require("./scheduledNoShowJob");
        void processScheduledNoShowRefunds();
      } catch (err) {
        console.log("err on scheduled no-show job:", err);
      }
    });
    void scheduledNoShowJob.start();

    const instantRecoveryJob = cron.schedule("* * * * *", () => {
      try {
        const { recoverExpiredInstantLessons } = require("./instantLessonRecoveryJob");
        void recoverExpiredInstantLessons();
      } catch (err) {
        console.log("err on instant recovery job:", err);
      }
    });
    void instantRecoveryJob.start();

    const bookingRemindersJob = cron.schedule("* * * * *", () => {
      try {
        const { processBookingReminders } = require("./bookingRemindersJob");
        void processBookingReminders();
      } catch (err) {
        console.log("err on booking reminders job:", err);
      }
    });
    void bookingRemindersJob.start();

    const scheduledChatDispatchJob = cron.schedule("* * * * *", () => {
      try {
        const { ChatExtrasService } = require("../modules/chat/chatExtrasService");
        const svc = new ChatExtrasService();
        void svc.dispatchDueScheduledMessages();
      } catch (err) {
        console.log("err on scheduled chat dispatch job:", err);
      }
    });
    void scheduledChatDispatchJob.start();

    const refundTransferReconcileJob = cron.schedule("*/10 * * * *", () => {
      try {
        const {
          reconcileProcessingRefundTransfers,
        } = require("../modules/wallet/refundTransferService");
        void reconcileProcessingRefundTransfers();
      } catch (err) {
        console.log("err on refund transfer reconcile job:", err);
      }
    });
    void refundTransferReconcileJob.start();

    const failedRefundReconcileJob = cron.schedule("0 */6 * * *", () => {
      try {
        const { reconcileFailedRefundTransfers } = require("../modules/wallet/escrowReconcileService");
        void reconcileFailedRefundTransfers();
      } catch (err) {
        console.log("err on failed refund reconcile job:", err);
      }
    });
    void failedRefundReconcileJob.start();

    const pendingTopUpJob = cron.schedule("*/15 * * * *", () => {
      try {
        const { reconcilePendingTopUps } = require("../modules/wallet/topUpService");
        void reconcilePendingTopUps();
      } catch (err) {
        console.log("err on pending top-up reconcile job:", err);
      }
    });
    void pendingTopUpJob.start();

    const extensionReconcileJob = cron.schedule("*/5 * * * *", () => {
      try {
        const { runExtensionReconcileJob } = require("./extensionReconcileJob");
        void runExtensionReconcileJob();
      } catch (err) {
        console.log("err on extension reconcile job:", err);
      }
    });
    void extensionReconcileJob.start();

    const chatMediaSweepJob = cron.schedule("0 */6 * * *", () => {
      try {
        const { runChatMediaSweepJob } = require("./chatMediaSweepJob");
        void runChatMediaSweepJob();
      } catch (err) {
        console.log("err on chat media sweep job:", err);
      }
    });
    void chatMediaSweepJob.start();

    // Daily at 03:15 — hard-delete accounts whose 15-day soft-delete
    // window has lapsed (Phase 2 item 15).
    const accountDeletionPurgeJob = cron.schedule("15 3 * * *", () => {
      try {
        const {
          processOverdueAccountDeletions,
        } = require("./accountDeletionPurgeJob");
        void processOverdueAccountDeletions();
      } catch (err) {
        console.log("err on account-deletion purge job:", err);
      }
    });
    void accountDeletionPurgeJob.start();
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

    // Single aggregate: find inactive trainees + their last completed session in one pass.
    // Replaces: distinct() + find($nin) + N x findOne() — was O(N+2) queries per run.
    const results = await booked_session.aggregate([
      // Last completed session per trainee in the past 30 days window
      {
        $match: {
          status: "completed",
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$trainee_id",
          lastSessionAt: { $first: "$createdAt" },
          trainer_id: { $first: "$trainer_id" },
        },
      },
      // Only trainees whose last session was 7–30 days ago
      {
        $match: {
          lastSessionAt: { $lt: sevenDaysAgo, $gte: thirtyDaysAgo },
        },
      },
      // Join user record
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "traineeDoc",
        },
      },
      { $unwind: "$traineeDoc" },
      {
        $match: {
          "traineeDoc.account_type": "Trainee",
          "traineeDoc.status": "approved",
          "traineeDoc.notifications.promotional.email": { $ne: false },
        },
      },
      // Join trainer name
      {
        $lookup: {
          from: "users",
          localField: "trainer_id",
          foreignField: "_id",
          pipeline: [{ $project: { fullname: 1 } }],
          as: "trainerDoc",
        },
      },
      {
        $project: {
          traineeId: "$_id",
          fullname: "$traineeDoc.fullname",
          category: "$traineeDoc.category",
          lastSessionAt: 1,
          lastTrainer: { $arrayElemAt: ["$trainerDoc.fullname", 0] },
        },
      },
      { $limit: 50 },
    ]);

    for (const row of results) {
      const daysSince = Math.floor(
        (Date.now() - new Date(row.lastSessionAt).getTime()) / 86400000
      );
      try {
        const content = await aiService.generateNotificationContent({
          userType: "Trainee",
          userName: row.fullname,
          daysSinceLastBooking: daysSince,
          category: row.category,
          lastTrainer: row.lastTrainer,
        });

        await notification.create({
          title: content.title,
          description: content.body,
          receiverId: row.traineeId,
          type: NotificationType.PROMOTIONAL,
        });

        void pushService.sendPushNotification(
          String(row.traineeId),
          content.title,
          content.body,
          { kind: "re_engagement" }
        );
      } catch (aiErr) {
        // Non-fatal: skip this user if AI fails
      }
    }

    console.log(`[SmartReEngagement] Processed ${results.length} inactive trainees.`);
  } catch (err) {
    console.error("[SmartReEngagement] Error:", err);
  }
}
