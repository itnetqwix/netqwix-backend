import { ResponseBuilder } from "../../helpers/responseBuilder";
import { log } from "../../../logger";
import * as l10n from "jm-ez-l10n";
import write_us from "../../model/write_us.schema";
import { signupModel } from "../auth/authValidator/signup";
import { updateBookedStatusModal, updateRatings } from "./userValidator";
import booked_session from "../../model/booked_sessions.schema";
import {
  BOOKED_SESSIONS_STATUS,
  MONGO_DATE_FORMAT,
  Netquix,
  NetquixImage,
  utcOffset,
} from "../../config/constance";
import mongoose, { ObjectId, PipelineStage, Types } from "mongoose";
import { AccountType } from "../auth/authEnum";
import { SendEmail } from "../../Utils/sendEmail";
import { Utils } from "../../Utils/Utils";
import moment = require("moment");
import { DateFormat } from "../../Utils/dateFormat";
import { getSearchRegexQuery } from "../../helpers/mongoose";
import { stripeHelperController } from "../stripe/stripeHelperController";
import raise_concern from "../../model/raise_concern.schema";
import { Constant, timeZoneAbbreviations } from "../../Utils/constant";
import onlineUser from "../../model/online_user.schema";
import SMSService from "../../services/sms-service";
import user from "../../model/user.schema";
import { DateTime } from "luxon";
import ReferredUser from "../../model/referred.user.schema";
const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class UserService {
  public log = log.getLogger();
  public async createNewUser(
    createUser: signupModel
  ): Promise<ResponseBuilder> {
    this.log.info(createUser);
    const userObj = new user(createUser);
    const emailTemplate =
      createUser.account_type === AccountType.TRAINER
        ? "trainer-welcome"
        : "trainee-welcome";

    SendEmail.sendRawEmail(
      emailTemplate,
      null,
      [createUser.email],
      "Welcome to Our Platform!",
      "Thank you for joining!"
    );

    await userObj.save();
    return ResponseBuilder.data(createUser, l10n.t("USER_PROFILE_SUCCESS"));
  }

  public async updateBookedSession(
    payload: updateBookedStatusModal,
    bookedSessionId: string,
    account_type
  ) {
    try {
      const bookedSessionDetail = await booked_session.findById(
        bookedSessionId
      );
      if (bookedSessionDetail && bookedSessionDetail._id) {
        if (bookedSessionDetail["status"] === BOOKED_SESSIONS_STATUS.cancel) {
          return ResponseBuilder.badRequest(
            l10n.t("SESSION_STATUS_CAN_NOT_REVERT")
          );
        }
        const result = await booked_session.findByIdAndUpdate(
          { _id: bookedSessionId },
          { status: payload.booked_status },
          { new: true }
        );
        
        // Emit booking status updated event
        try {
          const { emitBookingStatusUpdated } = require("../socket/socket.service");
          await emitBookingStatusUpdated(result);
        } catch (err) {
          console.error("[BOOKING] Error emitting booking status updated event:", err);
        }
        const bookedDate = Utils.formattedDateMonthDateYear(result.booked_date);
        const sessionDuration = Utils.timeDurations(
          result.session_start_time,
          result.session_end_time
        );
        const smsService = new SMSService()
        if (payload.booked_status === BOOKED_SESSIONS_STATUS.confirm) {
          const traineeInfo = await user.findById(
            bookedSessionDetail["trainee_id"]
          );
          const trainerInfo = await user.findById(
            bookedSessionDetail["trainer_id"]
          );
          const traineeName = traineeInfo.fullname;
          const trainerName = trainerInfo.fullname;
          if (traineeInfo.notifications.transactional.email) {
            const meetingLink = process.env.FRONTEND_URL_SMS + "/meeting?id=" + result._id;
            let trainerFormattedTime = `${bookedDate} ${sessionDuration}`;
            if (result.start_time) {
              try {
                const startTime = DateTime.fromJSDate(result.start_time, { zone: 'utc' });
                trainerFormattedTime = `${startTime.toFormat("EEEE, MMMM d'th' h:mm a")} ${timeZoneAbbreviations[result.time_zone] || result.time_zone || ''}`;
              } catch (_) {
                // keep fallback
              }
            }

            if (payload.booked_status === "confirmed" || payload.booked_status === BOOKED_SESSIONS_STATUS.confirm) {
              SendEmail.sendRawEmail(
                "session-confirmation",
                {
                  "[TRAINEE FIRST NAME]": traineeName.split(" ")[0],
                  "[SESSION DURATION]": sessionDuration,
                  "[TRAINER NAME]": trainerName,
                  "[session date and time in trainee timezone]": trainerFormattedTime,
                  "[MEETING_LINK]": meetingLink
                },
                [traineeInfo.email],
                `NetQwix Training Session is Confirmed`,
              );
            }

            else {
              SendEmail.sendRawEmail(
                null,
                null,
                [traineeInfo.email],
                `NetQwix Training Session has been ${payload.booked_status}`,
                null,
                `<div style="font-family: Verdana,Arial,Helvetica,sans-serif;font-size: 18px;line-height: 30px;">
          Hello <i  style='color:#ff0000'>${traineeName},</i>
          <br/><br/>
           Your NetQwix Training Session has been ${payload.booked_status} by your trainer <b><i style='color:#ff0000'>${trainerName}</i></b>
            for <b><i style='color:#ff0000'> ${bookedDate}.
           The session will last up to ${sessionDuration}.</i></b>
           <br/>
          Thank You
          <br/>
          Team NetQwix.
          <br/>
          <img src=${NetquixImage.logo} style="object-fit: contain; width: 180px;"/>
           </div> `
              );
            }

          }
          const meetingLink = process.env.FRONTEND_URL_SMS + "/meeting?id="

          if (traineeInfo.notifications.transactional.sms) {
            await smsService.sendSMS(traineeInfo.mobile_no, " NetQwix Training Session has been confirmed you may start the lesson using this link " + meetingLink + bookedSessionDetail._id);
          }
          if (trainerInfo.notifications.transactional.sms) {
            await smsService.sendSMS(trainerInfo.mobile_no, " NetQwix Training Session has been confirmed you may start the lesson using this link " + meetingLink + bookedSessionDetail._id);
          }
        }




        if (
          account_type === AccountType.TRAINER &&
          payload.booked_status === BOOKED_SESSIONS_STATUS.cancel
        ) {
          const payment_intent_id = bookedSessionDetail.payment_intent_id;
          const traineeInfo = await user.findById(
            bookedSessionDetail["trainee_id"]
          );
          const trainerInfo = await user.findById(
            bookedSessionDetail["trainer_id"]
          );
          const intent = await stripe.paymentIntents.retrieve(
            payment_intent_id
          );

          const latest_charge = intent.latest_charge;

          await stripe.refunds.create({
            charge: latest_charge,
            reverse_transfer: true,
            refund_application_fee: true,
          });

          await booked_session.findByIdAndUpdate(bookedSessionId, {
            refund_status: "refunded",
          });


          const traineeName = traineeInfo.fullname;
          const trainerName = trainerInfo.fullname;
          if (traineeInfo.notifications.transactional.email) {
            const startTime = DateTime.fromJSDate(result.start_time, { zone: 'utc' })
            const trainerFormattedTime = `${startTime.toFormat("EEEE, MMMM d'th' h:mm a")} ${timeZoneAbbreviations[result.time_zone] || result.time_zone}`
           
            SendEmail.sendRawEmail(
              "session-cancellation",
              {
                "[TRAINEE FIRST NAME]": traineeName.split(" ")[0],
                "[SESSION DURATION]": sessionDuration,
                "[TRAINER NAME]": trainerName,
                "[session date and time in trainee timezone]": trainerFormattedTime,
                // "[MEETING_LINK]": meetingLink
              },
              [traineeInfo.email],
              `NetQwix Training Session is Cancelled`,
            );

          }


          if (traineeInfo.notifications.transactional.sms) {
            const date = DateTime.fromJSDate(bookedSessionDetail.booked_date, { zone: "UTC" })
            // Combine date with start time
            const startDateTime = date.set({
              hour: parseInt(bookedSessionDetail.session_start_time.split(":")[0], 10),
              minute: parseInt(bookedSessionDetail.session_start_time.split(":")[1], 10)
            });

            // Combine date with end time
            const endDateTime = date.set({
              hour: parseInt(bookedSessionDetail.session_end_time.split(":")[0], 10),
              minute: parseInt(bookedSessionDetail.session_end_time.split(":")[1], 10)
            });
            const formatted = `${startDateTime.toFormat("MMM d'th', yyyy 'at' hh:mm a")} To ${endDateTime.toFormat("hh:mm a")} ${timeZoneAbbreviations[bookedSessionDetail.time_zone] || bookedSessionDetail.time_zone}`;
            await smsService.sendSMS(traineeInfo.mobile_no, `Your NetQwix session with ${formatted} was cancelled. Refund has been initiated.`);
          }
          if (trainerInfo.notifications.transactional.sms) {

            await smsService.sendSMS(trainerInfo.mobile_no, "Session cancelled." + bookedDate + " " + result.session_start_time + " " + result.session_end_time);
          }

        }
        return ResponseBuilder.data(
          { result },
          l10n.t("SESSION_STATUS_UPDATED")
        );
      } else {
        return ResponseBuilder.badRequest(l10n.t("INVALID_ID"));
      }
    } catch (err) {
      console.log(err);
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getMe(userInfo) {
    try {
      if (!userInfo) {
        return ResponseBuilder.data({ userInfo }, "User not found");
      }
      if (
        userInfo.account_type === AccountType.TRAINER &&
        !userInfo.is_kyc_completed
      ) {
        const result = await stripeHelperController.getAccountByUserId(
          userInfo.stripe_account_id
        );
        if (
          result?.external_accounts?.data?.length > 0 &&
          result?.charges_enabled == true &&
          result?.details_submitted == true
        ) {
          const { _id } = userInfo;
          const updatedUserInfo = await user
            .findByIdAndUpdate(_id, { is_kyc_completed: true })
            .select("-subscriptionId");
          if (!updatedUserInfo) {
            return ResponseBuilder.data({ userInfo }, "User not found");
          }
          return ResponseBuilder.data({ updatedUserInfo }, "KYC completed");
        }
        return ResponseBuilder.data(
          { userInfo },
          "KYC not completed of this user"
        );
      }
      return ResponseBuilder.data({ userInfo }, "");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async shareClips(userInfo) {
    try {
      if (!userInfo) {
        return ResponseBuilder.data({ userInfo }, "User not found");
      } else {
        var html = "";

        var clips = userInfo?.clips;

        for (let index = 0; index < clips.length; index++) {
          const element = clips[index];
          html =
            html +
            `
           <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; background-color: #fff; border-radius: 5px;">
              <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">Title : ${element?.title}</div>
              <p><a href="https://pub-fffe76fa8765416caa3d396262faa16a.r2.dev/${element?._id}" target="_blank">https://pub-fffe76fa8765416caa3d396262faa16a.r2.dev/${element?._id}</a></p>
            </div>`;
        }

        SendEmail.sendRawEmail(
          null,
          null,
          [userInfo?.user_email],
          `NetQwix Video Clips`,
          null,
          `<div>
            ${html}
          </div>`
        );

        return ResponseBuilder.data({}, "");
      }
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async inviteFriend(userInfo) {
    try {
      if (!userInfo) {
        return ResponseBuilder.data({ userInfo }, "User not found");
      } else {
        // const emailTemplate =
        //   userInfo._doc.account_type === AccountType.TRAINER
        //     ? "refer-expert"
        //     : "refer-trainee";
        const existingReferredUser = await ReferredUser.findOne<any>({ email: userInfo?.user_email });
        if(!existingReferredUser){
          const referredUser = new ReferredUser({
            email: userInfo?.user_email,
            referrerId: userInfo._doc._id,
          });
  
  
          await referredUser.save();
        }

        if (userInfo._doc.notifications.promotional.email) {
          if (userInfo._doc.account_type === AccountType.TRAINER) {
            SendEmail.sendRawEmail(
              "refer-expert",
              {
                "{FULLNAME}": `${userInfo._doc.fullname}`,
                "{FULLNAME1}": `${userInfo._doc.fullname}`,
                "{FULLNAME2}": `${userInfo._doc.fullname}`,
                "{FULLNAME3}": `${userInfo._doc.fullname}`,
                "{FIRSTNAME}": `${userInfo._doc.fullname.split(" ")[0]}`,
                "{FIRSTNAME1}": `${userInfo._doc.fullname.split(" ")[0]}`,
                "{FIRSTNAME2}": `${userInfo._doc.fullname.split(" ")[0]}`,
                "{FIRSTNAME3}": `${userInfo._doc.fullname.split(" ")[0]}`,
                "{FIRSTNAME4}": `${userInfo._doc.fullname.split(" ")[0]}`,
                "{PROFILE_PIC}": `https://data.netqwix.com/${userInfo._doc.profile_picture}`,
              },
              [userInfo?.user_email],
              `Exclusive Invitation to Join NetQwix Platform!`,
              null,
            );

          } else {
            SendEmail.sendRawEmail(
              "refer-friend",
              {
                "{FULLNAME}": `${userInfo._doc.fullname}`,
                "{PROFILE_PIC}": `https://data.netqwix.com/${userInfo._doc.profile_picture}`,
              },
              [userInfo?.user_email],
              `Exclusive Invitation to Join NetQwix Platform!`,
              null,
            );
          }
        }

        return ResponseBuilder.data({}, "");
      }
    } catch (err) {
      console.log("error", err)
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateIsPrivate(userId: ObjectId, isPrivate: boolean) {
    try {
      if (typeof isPrivate !== "boolean") {
        return ResponseBuilder.badRequest("is_private must be a boolean");
      }

      const updatedUserInfo = await user.findByIdAndUpdate(userId, {
        isPrivate,
      }, { new: true });

      if (!updatedUserInfo) {
        return ResponseBuilder.data([], "User not found");
      }

      return ResponseBuilder.data(updatedUserInfo, "User privacy setting updated successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateMobileNumber(userInfo: any, numbers: { old: string, new: string }) {
    try {
      if (userInfo.mobile_no !== numbers.old) {
        return ResponseBuilder.badRequest("old password is incorrect.");
      }

      const updatedUserInfo = await user.findByIdAndUpdate(userInfo._id, {
        mobile_no: numbers.new,
      }, { new: true });

      if (!updatedUserInfo) {
        return ResponseBuilder.data([], "User not found");
      }

      return ResponseBuilder.data(updatedUserInfo, "User privacy setting updated successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateNotificationSettings(userInfo: any, notifications) {
    try {


      const updatedUserInfo = await user.findByIdAndUpdate(userInfo._id, {
        notifications: notifications,
      }, { new: true });

      if (!updatedUserInfo) {
        return ResponseBuilder.data([], "User not found");
      }

      return ResponseBuilder.data(updatedUserInfo, "User Notification setting updated successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getScheduledMeetings(req) {
    const { authUser, query } = req;
    const { status, datetime, timezone } = query;
    try {
      let matchCondition = {};

      // Check both trainer_id and trainee_id to handle cases where user might have sessions in both roles
      // This is more flexible and handles edge cases where account_type might not match the session role
      const userId = new Types.ObjectId(authUser._id);
      matchCondition = {
        $or: [
          { trainer_id: userId },
          { trainee_id: userId }
        ]
      };

      // Debug logging
      this.log.debug("getScheduledMeetings - authUser:", {
        _id: authUser?._id,
        account_type: authUser?.account_type,
        status: query?.status,
        matchCondition
      });

      // Calculate the date from two days before today in UTC (only for upcoming/active sessions)
      // Use UTC-based calculations so comparisons against UTC-stored dates (booked_date) are consistent
      const twoDaysAgo = new Date();
      twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
      twoDaysAgo.setUTCHours(0, 0, 0, 0);

      // Handle status filtering
      let statusFilter = {};
      let additionalFilters: any = {};
      let dateFilter: any = { 
        $exists: true, 
        $ne: null
      };
      
      if (status) {
        const now = new Date();
        
        // Map API status values to database status values
        if (status === "cancelled") {
          statusFilter = { status: BOOKED_SESSIONS_STATUS.cancel };
          // For cancelled/completed, show all historical data (no date restriction)
          // Don't apply date filter for historical statuses
        } else if (status === "completed") {
          statusFilter = { status: BOOKED_SESSIONS_STATUS.completed };
          // For cancelled/completed, show all historical data (no date restriction)
          // Don't apply date filter for historical statuses
        } else if (status === "upcoming") {
          /**
           * Upcoming sessions:
           * - Backend returns all booked/confirmed sessions from the last 2 days
           *   (based on booked_date) for both trainer and trainee.
           * - Frontend `getScheduledMeetingDetails` already applies a robust,
           *   timezone-safe filter using raw `start_time` / `end_time` to decide
           *   what is truly "upcoming".
           *
           * To avoid double-filtering and brittle time comparisons across
           * timezones, we keep the backend simple here and let the frontend
           * own the final upcoming logic.
           */
          statusFilter = {
            status: {
              $in: [BOOKED_SESSIONS_STATUS.BOOKED, BOOKED_SESSIONS_STATUS.confirm],
            },
          };
          additionalFilters = {}; // Rely on frontend time-based filtering for "upcoming"
          // For upcoming, only show sessions from 2 days ago onwards by booked_date
          dateFilter = {
            $exists: true,
            $ne: null,
            $gte: twoDaysAgo,
          };
        } else {
          // Handle other status values directly (booked, confirmed, etc.)
          const statusMap = {
            "booked": BOOKED_SESSIONS_STATUS.BOOKED,
            "confirmed": BOOKED_SESSIONS_STATUS.confirm,
            "canceled": BOOKED_SESSIONS_STATUS.cancel,
          };
          if (statusMap[status]) {
            statusFilter = { status: statusMap[status] };
            // For active statuses, apply date filter
            dateFilter = { 
              $exists: true, 
              $ne: null,
              $gte: twoDaysAgo 
            };
          }
        }
      } else {
        // If no status filter, show all sessions (no date restriction)
        // This ensures trainees see all their bookings regardless of date
        dateFilter = { 
          $exists: true, 
          $ne: null
        };
      }

      const result = await booked_session
        .aggregate([
          {
            $match: {
              ...matchCondition,
              ...statusFilter,
              ...additionalFilters,
              // Make time_zone, start_time, and end_time optional (these fields may not exist in older records)
              // Only require session_start_time, session_end_time, and booked_date which are required fields
              session_end_time: { $exists: true, $ne: null },
              session_start_time: { $exists: true, $ne: null },
              booked_date: dateFilter
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "trainer_id",
              foreignField: "_id",
              as: "trainer_info",
              pipeline: [
                {
                  $project: Constant.pipelineUser,
                },
              ],
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "trainee_id",
              foreignField: "_id",
              as: "trainee_info",
              pipeline: [
                {
                  $project: Constant.pipelineUser,
                },
              ],
            },
          },
          {
            $lookup: {
              from: "clips",
              localField: "trainee_clip",
              foreignField: "_id",
              as: "trainee_clips",
            },
          },
          {
            $unwind: {
              path: "$trainer_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$trainee_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              status: 1,
              booked_date: 1,
              session_start_time: 1,
              session_end_time: 1,
              session_link: 1,
              createdAt: 1,
              updatedAt: 1,
              ratings: { $ifNull: ["$ratings", null] },
              trainer_info: 1,
              trainee_info: 1,
              trainee_clips: 1,
              time_zone: 1,
              start_time: 1,
              end_time: 1,
              report: 1,
              iceServers: 1,
              extended_session_end_time:1,
              extended_end_time:1,
              is_instant: { $ifNull: ["$is_instant", false] },
            },
          },
          {
            $sort: {
              createdAt: -1,
            },
          },
        ])
        .exec();

      // Debug logging
      this.log.debug("getScheduledMeetings - result count:", result?.length || 0);
      if (result?.length === 0) {
        // Try a simpler query to debug
        const simpleMatch = {
          ...matchCondition,
          ...statusFilter,
          session_end_time: { $exists: true, $ne: null },
          session_start_time: { $exists: true, $ne: null },
          booked_date: dateFilter
        };
        this.log.debug("getScheduledMeetings - match query:", JSON.stringify(simpleMatch, null, 2));
        const countResult = await booked_session.countDocuments(simpleMatch);
        this.log.debug("getScheduledMeetings - countDocuments result:", countResult);
      }

      return ResponseBuilder.data({ data: result }, l10n.t("MEETING_FETCHED"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateRatings(userInfo, payload: updateRatings, bookingInfo) {
    try {
      if (!bookingInfo.ratings) bookingInfo.ratings = {};
      const updatePayload =
        userInfo.account_type === AccountType.TRAINEE
          ? { ...bookingInfo.ratings, trainee: payload }
          : { ...bookingInfo.ratings, trainer: payload };
      if (
        updatePayload &&
        updatePayload.trainer &&
        updatePayload.trainee &&
        updatePayload.trainer.sessionRating &&
        updatePayload.trainee.sessionRating
      ) {
        bookingInfo.status = BOOKED_SESSIONS_STATUS.completed;
      }
      bookingInfo["ratings"] = updatePayload;
      await booked_session.findOneAndUpdate(
        { _id: bookingInfo["_id"] },
        { $set: { ...bookingInfo } },
        { new: true }
      );
      return ResponseBuilder.data({ bookingInfo }, l10n.t("RATING_SUBMITTED"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async addTraineeClip(payload: any, bookedSessionId: string) {
    try {
      const bookedSessionDetail = await booked_session.findById(
        bookedSessionId
      );
      if (bookedSessionDetail && bookedSessionDetail._id) {
        const result = await booked_session.findByIdAndUpdate(
          { _id: bookedSessionId },
          { trainee_clip: payload.trainee_clip },
          { new: true }
        );
        return ResponseBuilder.data(
          { result },
          l10n.t("SESSION_STATUS_UPDATED")
        );
      } else {
        return ResponseBuilder.badRequest(l10n.t("INVALID_ID"));
      }
    } catch (err) {
      console.log(err);
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllTrainee(userInfo: any) {
    try {
      const { _id } = userInfo;
      var trainee = await user.find({ account_type: AccountType.TRAINEE });
      if (!trainee) {
        return ResponseBuilder.data(trainee, "Trainee not found");
      }
      return ResponseBuilder.data(trainee, l10n.t("GET_ALL_TRAINEES"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllTrainers(userInfo: any) {
    try {
      const { _id } = userInfo;
      var trainer = await user.find({ account_type: AccountType.TRAINER });
      if (!trainer) {
        return ResponseBuilder.data(trainer, "Trainer not found");
      }
      return ResponseBuilder.data(trainer, l10n.t("GET_ALL_TRAINERS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllUsers(userInfo: any, searchTerm: string) {
    try {
      const { _id } = userInfo;

      // Define the search filter
      const searchFilter = searchTerm
        ? {
          $and: [
            {
              $or: [
                { fullname: { $regex: searchTerm, $options: "i" } },
                { email: { $regex: searchTerm, $options: "i" } },
              ],
            },
            { isPrivate: { $ne: true } },
            { _id: { $ne: _id } }, // Exclude the logged-in user
          ],
        }
        : { isPrivate: { $ne: true }, _id: { $ne: _id } }; // Exclude the logged-in user

      // Query the database with the filter
      const trainers = await user.find(searchFilter);

      if (!trainers || trainers.length === 0) {
        return ResponseBuilder.data(trainers, "Users not found");
      }
      return ResponseBuilder.data(trainers, l10n.t("GET_ALL_USERS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateTrainerCommossion(body) {
    try {
      const { trainer_id, commission } = body;
      if (!trainer_id) {
        return ResponseBuilder.badRequest("Trainer id is required");
      }

      // if (!commission) {
      //   return ResponseBuilder.badRequest("commission id is required");
      // }

      var trainer = await user.findByIdAndUpdate(trainer_id, { commission });

      if (!trainer) {
        return ResponseBuilder.data(trainer, "Trainer not found");
      }
      return ResponseBuilder.data(trainer, "Commission updated successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateIsRegisteredWithStript(userInfo: any, body: any) {
    try {
      const { _id } = userInfo;
      const { stripe_account_id } = body;

      if (!stripe_account_id) {
        return ResponseBuilder.badRequest("Stripe Account id can't be empty");
      }

      const updatedUserInfo = await user.findByIdAndUpdate(_id, {
        is_registered_with_stript: true,
        stripe_account_id,
      });
      if (!updatedUserInfo) {
        return ResponseBuilder.data([], "User not found");
      }

      return ResponseBuilder.data([], "User Register with stripe successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateIsKYCCompleted(userInfo: any) {
    try {
      const { _id } = userInfo;
      const updatedUserInfo = await user.findByIdAndUpdate(_id, {
        is_kyc_completed: true,
      });
      if (!updatedUserInfo) {
        return ResponseBuilder.data([], "User not found");
      }

      return ResponseBuilder.data([], "User KYC completed successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async createVerificationSessionStripeKYC(userInfo: any) {
    try {
      const session = await stripe.identity.verificationSessions.create({
        type: "document",
        metadata: {
          user_id: "{{USER_ID}}",
        },
        options: {
          document: {
            require_matching_selfie: true,
          },
        },
      });
      if (!session) {
        return ResponseBuilder.data([], "session not found");
      }

      return ResponseBuilder.data(
        { clientSecret: session.client_secret },
        "Session completed successfully"
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllBooking() {
    try {
      const pipeline: PipelineStage[] = [
        {
          $lookup: {
            from: "users",
            localField: "trainer_id",
            foreignField: "_id",
            as: "trainer_info",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trainee_id",
            foreignField: "_id",
            as: "trainee_info",
          },
        },
        {
          $addFields: {
            trainer_info: {
              $arrayElemAt: ["$trainer_info", 0],
            },
            trainee_info: {
              $arrayElemAt: ["$trainee_info", 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            trainer_id: 1,
            trainee_id: 1,
            status: 1,
            booked_date: 1,
            session_start_time: 1,
            session_end_time: 1,
            start_time: 1,
            end_time: 1,
            time_zone: 1,
            payment_intent_id: 1,
            trainee_clip: 1,
            report: 1,
            session_link: 1,
            updatedAt: 1,
            ratings: 1,
            refund_status: 1,
            "trainer_info.fullName": "$trainer_info.fullname",
            "trainer_info.commission": "$trainer_info.commission",
            "trainer_info.email": "$trainer_info.email",
            "trainer_info.category": "$trainer_info.category",
            "trainer_info.profilePicture": "$trainer_info.profile_picture",
            "trainer_info.stripe_account_id": "$trainer_info.stripe_account_id",
            "trainer_info.is_kyc_completed": "$trainer_info.is_kyc_completed",
            "trainee_info.fullName": "$trainee_info.fullname",
            "trainee_info.email": "$trainee_info.email",
            "trainee_info.profilePicture": "$trainee_info.profile_picture",
          },
        },
        {
          $sort: {
            updatedAt: -1, // Sort by updatedAt field in descending order
          },
        },
      ];
      const booking_list = await booked_session.aggregate(pipeline);

      if (!booking_list) {
        return ResponseBuilder.data([], "booking_list not found");
      }

      return ResponseBuilder.data(booking_list, "Booking Fetched successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllBookingById(
    trainer_id: any,
    account_type: any,
    page: any,
    limit: any
  ) {
    try {
      const matchObj: any = {};

      if (account_type === "Trainer") {
        matchObj.trainer_id = trainer_id;
      } else {
        matchObj.trainee_id = trainer_id;
      }

      // Calculate the date from two days before today
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      twoDaysAgo.setHours(0, 0, 0, 0); // Set to start of day

      const pipeline: PipelineStage[] = [
        {
          $match: {
            ...matchObj,
            // Filter bookings from two days before to future
            booked_date: { $gte: twoDaysAgo }
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trainer_id",
            foreignField: "_id",
            as: "trainer_info",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trainee_id",
            foreignField: "_id",
            as: "trainee_info",
          },
        },
        {
          $addFields: {
            trainer_info: {
              $arrayElemAt: ["$trainer_info", 0],
            },
            trainee_info: {
              $arrayElemAt: ["$trainee_info", 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            trainer_id: 1,
            trainee_id: 1,
            status: 1,
            booked_date: 1,
            session_start_time: 1,
            session_end_time: 1,
            start_time: 1,
            end_time: 1,
            time_zone: 1,
            payment_intent_id: 1,
            trainee_clip: 1,
            report: 1,
            session_link: 1,
            updatedAt: 1,
            ratings: 1,
            refund_status: 1,
            amount: 1,
            application_fee_amount: 1,
            "trainer_info.fullName": "$trainer_info.fullname",
            "trainer_info.commission": "$trainer_info.commission",
            "trainer_info.email": "$trainer_info.email",
            "trainer_info.category": "$trainer_info.category",
            "trainer_info.profilePicture": "$trainer_info.profile_picture",
            "trainer_info.stripe_account_id": "$trainer_info.stripe_account_id",
            "trainer_info.is_kyc_completed": "$trainer_info.is_kyc_completed",
            "trainee_info.fullName": "$trainee_info.fullname",
            "trainee_info.email": "$trainee_info.email",
            "trainee_info.profilePicture": "$trainee_info.profile_picture",
          },
        },
        {
          $sort: {
            updatedAt: -1, // Sort by updatedAt field in descending order
          },
        },
        {
          $skip: (Number(page) - 1) * Number(limit), // Skip records based on page and limit
        },
        {
          $limit: Number(limit), // Limit the number of records per page
        },
      ];
      const booking_list = await booked_session.aggregate(pipeline);

      if (!booking_list) {
        return ResponseBuilder.data([], "booking_list not found");
      }

      return ResponseBuilder.data(booking_list, "Booking Fetched successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async createStripeAccountVarificationUrl(body) {
    try {
      const { stripe_account_id } = body;

      const path = "dashboard";
      let linkUrl = process.env.CLIENT_URL + "/" + path;
      const generated_url = await stripe.accountLinks
        .create({
          type: "account_onboarding",
          account: stripe_account_id,
          refresh_url: `${linkUrl}?refresh=true`,
          return_url: `${linkUrl}?`,
          collect: "currently_due",
        })
        .then((link) => link.url);

      if (!generated_url) {
        return ResponseBuilder.badRequest(
          "Stripe KYC URL not generated please try again!"
        );
      }

      return ResponseBuilder.data(
        { url: generated_url },
        "KYC link generated successfully"
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async checkIsKycCompleted(userInfo: any, stripe_account_id: string) {
    try {
      if (!stripe_account_id) {
        return ResponseBuilder.data([], "Stripe Id not found");
      }
      const result = await stripeHelperController.getAccountByUserId(
        stripe_account_id
      );
      if (
        result?.external_accounts?.data?.length > 0 &&
        result?.charges_enabled == true &&
        result?.details_submitted == true
      ) {
        const { _id } = userInfo;
        const updatedUserInfo = await user.findByIdAndUpdate(_id, {
          is_kyc_completed: true,
        });
        if (!updatedUserInfo) {
          return ResponseBuilder.data([], "User not found");
        }
        return ResponseBuilder.data([], "User KYC completed successfully");
      } else {
        return ResponseBuilder.data([], "User KYC not completed successfully");
      }
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateRefundStatus(body) {
    try {
      const { booking_id, refund_status } = body;
      if (!booking_id) {
        return ResponseBuilder.badRequest("Booking id is required");
      }

      if (!refund_status) {
        return ResponseBuilder.badRequest("refund_status id is required");
      }

      var booking = await booked_session.findByIdAndUpdate(booking_id, {
        refund_status,
      });

      if (!booking) {
        return ResponseBuilder.badRequest("Booking not found");
      }

      return ResponseBuilder.data(
        {
          booking,
        },
        "refund_status updated successfully"
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async captureWriteUs(id, body) {
    try {
      const { reason, description } = body;

      if (!description) {
        return ResponseBuilder.badRequest("Description id is required");
      }

      const writeUs = new write_us({ ...body, user_id: id });
      await writeUs.save();

      return ResponseBuilder.data(writeUs, "Complain has been captured");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async createRaiseConcern(id, body) {
    try {
      const { reason, description } = body;
      if (!reason) {
        return ResponseBuilder.badRequest("Reason is required");
      }

      if (!description) {
        return ResponseBuilder.badRequest("Description id is required");
      }

      const raiseConcern = new raise_concern({ ...body, user_id: id });
      await raiseConcern.save();

      return ResponseBuilder.data(raiseConcern, "Complain has been captured");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getCaptureWriteUs() {
    try {
      const pipeline: PipelineStage[] = [
        {
          $lookup: {
            from: "users",
            localField: "user_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $addFields: {
            user_info: {
              $arrayElemAt: ["$user_info", 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            user_id: 1,
            ticket_status: 1,
            name: 1,
            email: 1,
            phone_number: 1,
            subject: 1,
            description: 1,
            updatedAt: 1,
            "user_info.fullName": "$user_info.fullname",
            "user_info.commission": "$user_info.commission",
            "user_info.email": "$user_info.email",
            "user_info.category": "$user_info.category",
            "user_info.profilePicture": "$user_info.profile_picture",
            "user_info.stripe_account_id": "$user_info.stripe_account_id",
            "user_info.is_kyc_completed": "$user_info.is_kyc_completed",
            "user_info.account_type": "$user_info.account_type",
          },
        },
        {
          $sort: {
            updatedAt: -1,
          },
        },
      ];
      const booking_list = await write_us.aggregate(pipeline);

      if (!booking_list) {
        return ResponseBuilder.data([], "booking_list not found");
      }

      return ResponseBuilder.data(booking_list, "Booking Fetched successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getRaiseConcern() {
    try {
      const pipeline: PipelineStage[] = [
        {
          $lookup: {
            from: "users",
            localField: "user_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $lookup: {
            from: "booked_sessions",
            localField: "booking_id",
            foreignField: "_id",
            as: "booking_details",
          },
        },
        {
          $addFields: {
            user_info: {
              $arrayElemAt: ["$user_info", 0],
            },
            booking_details: {
              $arrayElemAt: ["$booking_details", 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            user_id: 1,
            booking_id: 1,
            ticket_status: 1,
            name: 1,
            email: 1,
            phone_number: 1,
            reason: 1,
            subject: 1,
            description: 1,
            updatedAt: 1,
            is_releted_to_refund: 1,
            "user_info.fullName": "$user_info.fullname",
            "user_info.commission": "$user_info.commission",
            "user_info.email": "$user_info.email",
            "user_info.category": "$user_info.category",
            "user_info.profilePicture": "$user_info.profile_picture",
            "user_info.stripe_account_id": "$user_info.stripe_account_id",
            "user_info.is_kyc_completed": "$user_info.is_kyc_completed",
            "user_info.account_type": "$user_info.account_type",
            booking_details: "$booking_details",
          },
        },
        {
          $sort: {
            updatedAt: -1, // Sort by updatedAt field in descending order
          },
        },
      ];
      const booking_list = await raise_concern.aggregate(pipeline);

      if (!booking_list) {
        return ResponseBuilder.data([], "booking_list not found");
      }

      return ResponseBuilder.data(booking_list, "Booking Fetched successfully");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateWriteUsTicketStatus(body) {
    try {
      const { id, ticket_status } = body;
      if (!id) {
        return ResponseBuilder.badRequest("ID is required");
      }

      if (!ticket_status) {
        return ResponseBuilder.badRequest("ticket_status id is required");
      }

      var contactUsResponse = await write_us.findByIdAndUpdate(id, {
        ticket_status,
      });

      if (!contactUsResponse) {
        return ResponseBuilder.badRequest("Booking not found");
      }

      return ResponseBuilder.data(
        {
          contactUsResponse,
        },
        "Ticket status updated successfully"
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateRaiseConcernTicketStatus(body) {
    try {
      const { id, ticket_status } = body;
      if (!id) {
        return ResponseBuilder.badRequest("ID is required");
      }

      if (!ticket_status) {
        return ResponseBuilder.badRequest("ticket_status id is required");
      }

      var raiseConcernResponse = await raise_concern.findByIdAndUpdate(id, {
        ticket_status,
      });

      if (!raiseConcernResponse) {
        return ResponseBuilder.badRequest("Booking not found");
      }

      return ResponseBuilder.data(
        {
          raiseConcernResponse,
        },
        "Ticket status updated successfully"
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllLatestOnlineUser() {
    try {
      const pipeline: PipelineStage[] = [
        {
          $lookup: {
            from: "users",
            localField: "trainer_id",
            foreignField: "_id",
            as: "trainer_info",
          },
        },
        {
          $addFields: {
            trainer_info: {
              $arrayElemAt: ["$trainer_info", 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            last_activity_time: 1,
            updatedAt: 1,
            "trainer_info._id": "$trainer_info._id",
            "trainer_info.fullName": "$trainer_info.fullname",
            "trainer_info.commission": "$trainer_info.commission",
            "trainer_info.email": "$trainer_info.email",
            "trainer_info.category": "$trainer_info.category",
            "trainer_info.profile_picture": "$trainer_info.profile_picture",
            "trainer_info.stripe_account_id": "$trainer_info.stripe_account_id",
            "trainer_info.is_kyc_completed": "$trainer_info.is_kyc_completed",
            "trainer_info.extraInfo": "$trainer_info.extraInfo",
            "trainer_info.status": "$trainer_info.status",
          },
        },
        {
          $sort: {
            updatedAt: -1, // Sort by updatedAt field in descending order
          },
        },
      ];
      const trainer = await onlineUser.aggregate(pipeline);
      if (!trainer) {
        return ResponseBuilder.data(trainer, "online Trainer not found");
      }
      return ResponseBuilder.data(trainer, l10n.t("GET_ALL_TRAINERS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }


  public async updateTrainerStatus(
    trainerId: string,
    status: string
  ): Promise<any> {
    try {
      console.log("Updating trainer status:", { trainerId, status });
      if (!["approved", "rejected", "pending"].includes(status)) {
        return ResponseBuilder.error(null, "Invalid status value");
      }
      const trainer = await user.findByIdAndUpdate(
        trainerId,
        { status: status },
        { new: true }
      );
      if (!trainer) {
        return ResponseBuilder.badRequest("Trainer not found");
      }
      return ResponseBuilder.data({
        code: 200,
        result: trainer,
        msg: `Trainer ${status} successfully`,
      });
    } catch (err) {
      console.error("Error updating trainer status:", err);
      return ResponseBuilder.error(
        err,
        l10n.t("ERR_INTERNAL_SERVER") || "Internal Server Error"
      );
    }
  }

  public async approveTrainer(trainerId: string): Promise<any> {
    try {
      console.log("Updating trainer status:", { trainerId });

      // Find the trainer first
      const trainer = await user.findById(trainerId);
      console.log("trainer", trainer);

      if (!trainer) {
        return this.getErrorHtml("Trainer Not Found", "The trainer you're trying to approve doesn't exist.");
      }

      // Check if the current status is pending
      if (trainer.status === "approved") {
        return this.getErrorHtml("Already Approved", "This expert is already approved.");
      }

      if (trainer.status === "rejected") {
        return this.getErrorHtml("Cannot Approve Rejected Expert",
          "Expert is rejected. You cannot approve a rejected user using this link. Please update from admin panel.");
      }

      // Update the status to approved
      trainer.status = "approved";
      await trainer.save();

      return this.getSuccessHtml("Expert Approved", `Expert ${trainer.fullname} approved successfully!`);
    } catch (err) {
      console.error("Error updating trainer status:", err);
      return this.getErrorHtml("Server Error",
        l10n.t("ERR_INTERNAL_SERVER") || "Internal Server Error");
    }
  }

  private getSuccessHtml(title: string, message: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title}</title>
        <style>
            body {
                font-family: 'Arial', sans-serif;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
            }
            .container {
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                padding: 30px;
                max-width: 500px;
                text-align: center;
            }
            .success-icon {
                color: #4CAF50;
                font-size: 60px;
                margin-bottom: 20px;
            }
            h1 {
                color: #333;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .btn {
                display: inline-block;
                background-color: #4CAF50;
                color: white;
                padding: 10px 20px;
                text-decoration: none;
                border-radius: 4px;
                transition: background-color 0.3s;
            }
            .btn:hover {
                background-color: #45a049;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✓</div>
            <h1>${title}</h1>
            <p>${message}</p>
            <a href=${process.env.ADMIN_APP_URL} class="btn">Go to Dashboard</a>
        </div>
    </body>
    </html>
    `;
  }

  public getErrorHtml(title: string, message: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title}</title>
        <style>
            body {
                font-family: 'Arial', sans-serif;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
            }
            .container {
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                padding: 30px;
                max-width: 500px;
                text-align: center;
            }
            .error-icon {
                color: #f44336;
                font-size: 60px;
                margin-bottom: 20px;
            }
            h1 {
                color: #333;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .btn {
                display: inline-block;
                background-color: #f44336;
                color: white;
                padding: 10px 20px;
                text-decoration: none;
                border-radius: 4px;
                transition: background-color 0.3s;
            }
            .btn:hover {
                background-color: #d32f2f;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="error-icon">✗</div>
            <h1>${title}</h1>
            <p>${message}</p>
            <a href=${process.env.ADMIN_APP_URL} class="btn">Go to Dashboard</a>
        </div>
    </body>
    </html>
    `;
  }

}
