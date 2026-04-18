import { log } from "../../../logger";
import {
  BOOKED_SESSIONS_STATUS,
  CONSTANCE,
  NetquixImage,
  amountType,
  timeRegex,
} from "../../config/constance";
import {
  getSearchRegexQuery,
  isValidMongoObjectId,
} from "../../helpers/mongoose";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import schedule_inventory from "../../model/schedule_inventory.schema";
import * as l10n from "jm-ez-l10n";
import { bookSessionModal, bookInstantMeetingModal } from "./traineeValidator";
import booked_session from "../../model/booked_sessions.schema";
import { PipelineStage } from "mongoose";
import { DateFormat } from "../../Utils/dateFormat";
import { SendEmail } from "../../Utils/sendEmail";
import user from "../../model/user.schema";
import { CovertTimeAccordingToTimeZone, isOverlap, Utils } from "../../Utils/Utils";
import * as mongoose from "mongoose";
import { Failure } from "../../helpers/error";
import { DateTime } from "luxon";
import SMSService from "../../services/sms-service";
import { timeZoneAbbreviations } from "../../Utils/constant";

export class TraineeService {
  public log = log.getLogger();

  public async getSlotsOfAllTrainers(query): Promise<any> {
    try {
      const {
        search,
        day = null,
        time = JSON.stringify({ from: "00:00", to: "23:59" }),
      } = query;
      if (
        typeof search !== "string" ||
        search.trim() === "" ||
        !isNaN(Number(search))
      ) {
        return ResponseBuilder.badRequest(
          "Search parameter must be a non-empty string",
          400
        );
      }
      let searchQuery = getSearchRegexQuery(
        search,
        CONSTANCE.USERS_SEARCH_KEYS
      );

      // const filteredTrainer =
      //   (day && day.length) || (time && time.length)
      //     ? (
      //         await this.filterTrainersByDayAndTime(
      //           day,
      //           time ? JSON.parse(time) : null
      //         )
      //       ).map((trainer) => trainer.trainer_id)
      //     : [];
      // console.info("searchQuery---", JSON.stringify(searchQuery));
      // const result = await schedule_inventory.aggregate([
      //   {
      //     $match:
      //       Array.isArray(filteredTrainer) && filteredTrainer.length
      //         ? {
      //             trainer_id: { $in: filteredTrainer || [] },
      //           }
      //         : {},
      //   },
      //   {
      //     $lookup: {
      //       from: "users",
      //       localField: "trainer_id",
      //       foreignField: "_id",
      //       as: "trainer",
      //     },
      //   },
      //   {
      //     $match: searchQuery,
      //   },
      //   {
      //     $lookup: {
      //       from: "booked_sessions",
      //       localField: "trainer_id",
      //       foreignField: "trainer_id",
      //       let: {
      //         session_booked_trainer_id: "$trainer_id",
      //         session_booked_status: "$status",
      //         session_ratings: "$ratings",
      //       },
      //       pipeline: [
      //         {
      //           $lookup: {
      //             from: "users",
      //             localField: "trainee_id",
      //             foreignField: "_id",
      //             as: "trainee_info",
      //           },
      //         },
      //         {
      //           $match: {
      //             $or: [
      //               { status: BOOKED_SESSIONS_STATUS.confirm },
      //               { status: BOOKED_SESSIONS_STATUS.completed },
      //             ],
      //           },
      //         },
      //         {
      //           $project: {
      //             status: 1,
      //             trainee_fullname: {
      //               $arrayElemAt: ["$trainee_info.fullname", 0],
      //             },
      //             updatedAt: 1,
      //             ratings: {
      //               trainee: {
      //                 sessionRating: 1,
      //                 recommendRating: 1,
      //                 audioVideoRating: 1,
      //                 title: 1,
      //                 remarksInfo: 1,
      //                 traineeFullname: 1,
      //               },
      //             },
      //           },
      //         },
      //       ],
      //       as: "trainer_ratings",
      //     },
      //   },
      //   {
      //     $project: {
      //       _id: 1,
      //       trainer_ratings: 1,
      //       trainer_id: 1,
      //       available_slots: 1,
      //       extraInfo: { $arrayElemAt: ["$trainer.extraInfo", 0] },
      //       fullname: { $arrayElemAt: ["$trainer.fullname", 0] },
      //       email: { $arrayElemAt: ["$trainer.email", 0] },
      //       category: { $arrayElemAt: ["$trainer.category", 0] },
      //       profilePicture: { $arrayElemAt: ["$trainer.profile_picture", 0] },
      //     },
      //   },
      // ]);
      const pipeline: PipelineStage[] = [
        {
          $match: {
            $and: [{ account_type: "Trainer" }],
            $or: searchQuery.$or,
          },
        },
        {
          $lookup: {
            from: "booked_sessions",
            localField: "_id",
            foreignField: "trainer_id",
            pipeline: [
              {
                $lookup: {
                  from: "users",
                  localField: "trainee_id",
                  foreignField: "_id",
                  as: "trainee_info",
                },
              },
              {
                $match: {
                  $or: [
                    { status: BOOKED_SESSIONS_STATUS.confirm },
                    { status: BOOKED_SESSIONS_STATUS.completed },
                  ],
                },
              },
              {
                $project: {
                  status: 1,
                  trainee_fullname: {
                    $arrayElemAt: ["$trainee_info.fullname", 0],
                  },
                  updatedAt: 1,
                  ratings: 1,
                },
              },
            ],
            as: "trainer_ratings",
          },
        },
        {
          $project: {
            _id: 1,
            available_slots: CONSTANCE.SCHEDULING_SLOTS.available_slots,
            trainer_id: "$_id",
            trainer_ratings: 1,
            extraInfo: 1,
            fullname: 1,
            email: 1,
            category: 1,
            profile_picture: "$profile_picture",
            stripe_account_id: 1,
            is_kyc_completed: 1,
            commission: 1,
            status:1
          },
        },
      ];
      const result = await user.aggregate(pipeline);
      return ResponseBuilder.data(result, l10n.t("GET_ALL_SLOTS"));
    } catch (err) {
      console.error(`Error getting slots of all trainers:`, err);
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public filterTrainersByDayAndTime = async (day, time) => {
    try {
      const result = await schedule_inventory
        .aggregate([
          {
            $unwind: "$available_slots",
          },
          {
            $match: day
              ? {
                "available_slots.day": day,
              }
              : {},
          },
          {
            $unwind: "$available_slots.slots",
          },
          {
            $match: {
              "available_slots.slots.start_time": { $ne: "" }, // Exclude slots with empty start_time
              "available_slots.slots.end_time": { $ne: "" }, // Exclude slots with empty start_time
              $expr: {
                $and: [
                  {
                    $gte: ["$available_slots.slots.end_time", time.form],
                  },
                  {
                    $lte: ["$available_slots.slots.start_time", time.to],
                  },
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              trainer_id: 1,
              available_slots: 1,
            },
          },
        ])
        .exec();

      return result;
    } catch (err) {
      console.error(`Error filtering trainers by day and time:`, err);
      throw err;
    }
  };

  public async bookSession(
    payload: bookSessionModal,
    _id: string
  ): Promise<ResponseBuilder> {
    try {
      if (
        !payload ||
        !payload.trainer_id ||
        !payload.booked_date ||
        !payload.session_start_time ||
        !payload.session_end_time ||
        !payload.charging_price ||
        !payload.time_zone
      ) {
        const validationError: Failure = {
          type: "BAD_DATA",
          name: "",
          message: "",
          description: "Invalid input data",
          errorStack: "",
          title: "Bad Request",
          data: null,
        };
        return ResponseBuilder.error(validationError, "Invalid input data");
      }
      if (
        !timeRegex.test(
          typeof payload.session_start_time === "string" &&
          payload.session_start_time
        ) ||
        !timeRegex.test(
          typeof payload.session_end_time === "string" &&
          payload.session_end_time
        )
      ) {
        return ResponseBuilder.badRequest(
          "Invalid time format. Please use HH:mm format."
        );
      }
      // Compute start_time/end_time as proper UTC Date objects so the booking
      // displays correctly in each viewer's local timezone (trainer and trainee).
      let start_time: Date | undefined;
      let end_time: Date | undefined;
      try {
        const rawDate = typeof payload.booked_date === "string"
          ? payload.booked_date.split("T")[0]
          : new Date(payload.booked_date as any).toISOString().split("T")[0];
        const sessionStartTime = String(payload.session_start_time);
        const sessionEndTime = String(payload.session_end_time);
        const [startH, startM] = sessionStartTime.split(":").map(Number);
        const [endH, endM] = sessionEndTime.split(":").map(Number);
        const startDT = DateTime.fromObject(
          { year: Number(rawDate.split("-")[0]), month: Number(rawDate.split("-")[1]), day: Number(rawDate.split("-")[2]), hour: startH, minute: startM, second: 0 },
          { zone: payload.time_zone }
        );
        let endDT = DateTime.fromObject(
          { year: Number(rawDate.split("-")[0]), month: Number(rawDate.split("-")[1]), day: Number(rawDate.split("-")[2]), hour: endH, minute: endM, second: 0 },
          { zone: payload.time_zone }
        );
        if (endDT <= startDT) endDT = endDT.plus({ days: 1 });
        if (startDT.isValid && endDT.isValid) {
          start_time = startDT.toJSDate();
          end_time = endDT.toJSDate();
        }
      } catch (_e) {
        // Non-fatal: fall back to null so existing behaviour is preserved
      }

      const sessionObj = new booked_session({
        ...payload,
        trainee_id: _id,
        time_zone: payload.time_zone,
        ...(start_time && { start_time }),
        ...(end_time && { end_time }),
      });
      const trainerId = sessionObj["trainer_id"];
      const trainerDetails = await user.findById({ _id: trainerId });
      const traineeId = sessionObj["trainee_id"];
      const traineeDetails = await user.findById({ _id: traineeId });
      const bookedDate = Utils.formattedDateMonthDateYear(
        sessionObj["booked_date"]
      );
      const startTime = Utils.convertToAmPm(sessionObj["session_start_time"]);
      const endTime = Utils.convertToAmPm(sessionObj["session_end_time"]);

      const timeZoneInShort = DateTime.now()
        .setZone(payload.time_zone)
        .toFormat("ZZZZ");
      const bookedTime = `${startTime} To ${endTime}`;
      const subjectTrainee = `NetQwix Training Session Booked for ${bookedDate} at ${bookedTime} ${timeZoneAbbreviations[sessionObj.time_zone] || sessionObj.time_zone}`;
      const timeZoneInShortForTrainer = DateTime.now()
        .setZone(trainerDetails.extraInfo.availabilityInfo.timeZone)
        .toFormat("ZZZZ");
      const subjectTrainer = `NetQwix Training Session Booked for ${bookedDate} at ${bookedTime} ${timeZoneAbbreviations[trainerDetails.extraInfo.availabilityInfo.timeZone] ||trainerDetails.extraInfo.availabilityInfo.timeZone}`;
      
      const charging_price = `${amountType.USD}${+payload.charging_price}.`;
      const meetingLink = process.env.FRONTEND_URL_SMS + "/meeting?id="+ sessionObj["_id"];

      if (traineeDetails.notifications.transactional.email) {

        SendEmail.sendRawEmail(
          "session-booking-trainee",
          {
            "[TRAINEE FIRST NAME]":traineeDetails.fullname.split(" ")[0],
            "[TRAINER NAME]":trainerDetails.fullname,
            "[session date and time]":`${bookedDate} at ${bookedTime} ${timeZoneAbbreviations[sessionObj.time_zone] || sessionObj.time_zone}`,
            "[MEETING_LINK]":meetingLink
          },
          traineeDetails.email,
          "NetQwix Training Session is Booked",
        );
      }
      if (trainerDetails.notifications.transactional.email) {

        SendEmail.sendRawEmail(
          "session-booking-trainer",
          {
            "[TRAINER FIRST NAME]":trainerDetails.fullname.split(" ")[0],
            "[TRAINEE_NAME]":traineeDetails.fullname,
            "[session date and time]":`${bookedDate} at ${bookedTime} ${timeZoneAbbreviations[trainerDetails.extraInfo.availabilityInfo.timeZone] ||trainerDetails.extraInfo.availabilityInfo.timeZone}`,
            "[MEETING_LINK]":meetingLink
          },
          trainerDetails.email,
          "NetQwix Training Session is Booked",
        );
      }

      const smsService = new SMSService();
      if (trainerDetails.notifications.transactional.sms) {

        await smsService.sendSMS(
          trainerDetails.mobile_no,
          subjectTrainee + " With " + traineeDetails.fullname
        )
      }
      if (traineeDetails.notifications.transactional.sms) {

        await smsService.sendSMS(
          traineeDetails.mobile_no,
          subjectTrainer + " With " + trainerDetails.fullname
        );
      }
      if (payload.status === BOOKED_SESSIONS_STATUS["BOOKED"]) {
        if (traineeDetails.notifications.transactional.email) {

          SendEmail.sendRawEmail(
            "payment-confirmation",
            {
              "[First Name]":traineeDetails.fullname.split(" ")[0],
              "[AMOUNT]":charging_price,
              "[TRAINER NAME]":trainerDetails.fullname,
              "[TRAINER NAME2]":trainerDetails.fullname
            },
            [traineeDetails.email],
            "NetQwix Payment Confirmation",
          );
        }
      }
      var bookingData = await sessionObj.save();
      await user.updateOne(
        { _id: payload.trainer_id },
        { $inc: { wallet_amount: +payload.charging_price || 0 } }
      );
      
      // Emit booking created event
      try {
        const { emitBookingCreated } = require("../socket/socket.service");
        await emitBookingCreated(bookingData, 'scheduled');
      } catch (err) {
        console.error("[BOOKING] Error emitting booking created event:", err);
      }
      
      return ResponseBuilder.data(bookingData, l10n.t("SESSION_BOOKED"));
    } catch (err) {
      console.error("Error booking session:", err);
      const failure: Failure = {
        description: err.message,
        errorStack: err.stack || "",
        title: "Internal Server Error",
        type: "CODE",
        data: null,
        name: "",
        message: "",
      };
      return ResponseBuilder.error(failure, "ERR_INTERNAL_SERVER");
    }
  }

  /**
   * Book an instant meeting. Does not depend on trainer schedule or timezone.
   * Uses server UTC "now" so the trainee can request at any time and the trainer
   * receives the request in upcoming lessons regardless of timezone.
   */
  public async bookInstantMeeting(
    payload: bookInstantMeetingModal,
    _id: string
  ): Promise<ResponseBuilder> {
    const { trainer_id, duration: durationMinutes } = payload;
    try {
      // Use server UTC "now" so instant lesson works for any trainee/trainer timezone
      const nowUtc = new Date();
      const booked_date = payload.booked_date ? new Date(payload.booked_date) : nowUtc;

      // Duration in minutes (15, 30, 60, 120). Default 30.
      const duration = durationMinutes && [15, 30, 60, 120].includes(Number(durationMinutes))
        ? Number(durationMinutes)
        : 30;

      const session_start_time = DateFormat.addMinutes(
        booked_date,
        0,
        CONSTANCE.INSTANT_MEETING_TIME_FORMAT
      );

      const session_end_time = DateFormat.addMinutes(
        booked_date,
        duration,
        CONSTANCE.INSTANT_MEETING_TIME_FORMAT
      );

      // Set start_time/end_time (Date) so getScheduledMeetings, active sessions, and timers
      // match the selected instant-lesson duration window.
      const start_time = new Date(booked_date);
      const end_time = new Date(start_time.getTime() + duration * 60 * 1000);

      const userObj = new booked_session({
        trainer_id,
        trainee_id: _id,
        status: BOOKED_SESSIONS_STATUS.confirm,
        booked_date,
        session_start_time,
        session_end_time,
        start_time,
        end_time,
        is_instant: true,
      });

      const bookingData = await userObj.save();

      // Emit booking created event for instant lesson (trainer sees in upcoming / gets popup)
      try {
        const { emitBookingCreated } = require("../socket/socket.service");
        await emitBookingCreated(bookingData, "instant");
      } catch (err) {
        console.error("[BOOKING] Error emitting instant booking created event:", err);
      }

      const trainerDetails = await user
        .findById(trainer_id)
        .select({ _id: 0, fullname: 1, email: 1 });
      if (trainerDetails?.notifications?.transactional?.email) {
        SendEmail.sendRawEmail(
          "meeting",
          {
            "{NAME}": `${trainerDetails.fullname}`,
            "{MEETING_URL}": "https://google.com",
          },
          [trainerDetails.email],
          "Instant Meeting"
        );
      }

      // Return booking id so frontend can use it as lessonId for socket INSTANT_LESSON.REQUEST
      return ResponseBuilder.data(
        { bookingId: bookingData._id, booking: bookingData },
        l10n.t("INSTANT_MEETING_BOOKED")
      );
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updateProfile(reqBody, authUser): Promise<ResponseBuilder> {
    try {


      await user.findOneAndUpdate(
        { _id: authUser["_id"].toString() },
        { $set: { ...reqBody } },
        { new: true }
      );
      return ResponseBuilder.data({}, l10n.t("PROFILE_UPDATED"));
    } catch (err) {
      throw err;
    }
  }

  public async checkSlotExist(reqBody): Promise<ResponseBuilder> {
    try {
      const { slotTime, trainer_id, booked_date, traineeTimeZone } = reqBody;

      // Validate required fields
      if (!slotTime?.from || !slotTime?.to) {
        return ResponseBuilder.badRequest("Missing slot time", 400);
      }
      if (!traineeTimeZone) {
        return ResponseBuilder.badRequest("Missing trainee timezone", 400);
      }
      if (!booked_date) {
        return ResponseBuilder.badRequest("Missing booked date", 400);
      }
      if (!trainer_id) {
        return ResponseBuilder.badRequest("Missing trainer ID", 400);
      }

      // Fetch trainer info
      const trainerInfo = await user.findById(trainer_id);
      if (!trainerInfo?.extraInfo?.availabilityInfo) {
        return ResponseBuilder.badRequest("Trainer availability not set", 400);
      }

      const { availabilityInfo } = trainerInfo.extraInfo;

      // Determine day of the week
      const date = DateTime.fromISO(booked_date, { zone: 'utc' });
      const dayOfWeek = date.toFormat("ccc");
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      // const dayOfWeek = days[date.getDay()];
      // Get trainer's availability for the day
      const dayAvailability = availabilityInfo.availability?.[dayOfWeek] || [];
      if (dayAvailability.length === 0) {
        return ResponseBuilder.data({
          isAvailable: false,
          availableSlots: [],
          message: "Trainer not available on this day",
          trainerTimezone: availabilityInfo.timeZone,
          traineeTimezone: traineeTimeZone,
        });
      }

      const timeSlots = Utils.generateTimeSlots(
        dayAvailability,
        availabilityInfo,
        booked_date,
        traineeTimeZone
      );

      // Fetch existing bookings
      const existingBookings = await booked_session
        .aggregate([
          {
            $match: {
              trainer_id: new mongoose.Types.ObjectId(trainer_id),
              status: { $ne: BOOKED_SESSIONS_STATUS.cancel },
              $expr: {
                $eq: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$booked_date",
                    },
                  },
                  booked_date.split("T")[0],
                ],
              },
            },
          },
          {
            $project: {
              start_time: 1,
              end_time: 1,
              time_zone: 1
            },
          },
        ])
        .exec();

      // Convert existing bookings' times to trainee's time zone only if necessary
      const normalizedBookings = existingBookings.map(booking => {

        let startTraineeTime = booking.start_time
        let endTraineeTime = booking.end_time
        if (traineeTimeZone !== booking.time_zone) {
          startTraineeTime = new Date(CovertTimeAccordingToTimeZone(booking.start_time, {
            to: traineeTimeZone,
            from: booking.time_zone,
          }).ts);
          endTraineeTime = new Date(CovertTimeAccordingToTimeZone(booking.end_time, {
            to: traineeTimeZone,
            from: booking.time_zone,
          }).ts);
        }
        return { start: startTraineeTime, end: endTraineeTime };
      });

      // Remove overlapping available slots
      const availableSlots = timeSlots.filter(slot => {
        return !normalizedBookings.some(booking => isOverlap(slot, booking));
      });

      return ResponseBuilder.data({
        isAvailable: availableSlots.length > 0,
        availableSlots: availableSlots,
        trainerTimezone: availabilityInfo.timeZone,
        traineeTimezone: availableSlots,
        debug: {
          dayOfWeek,
          dayAvailability,
          existingBookings,
          requestedTimeRange: { from: slotTime.from, to: slotTime.to },
          slotsBeforeFiltering: dayAvailability.length,
        },
      });
    } catch (error) {
      console.error("Error in checkSlotExist:", error);
      return ResponseBuilder.errorMessage("An error occurred");
    }
  }
}
