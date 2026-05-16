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
import { recordUserActivityMany, UserActivityEvent } from "../../helpers/userActivity";
import mongoose, { PipelineStage } from "mongoose";
import { DateFormat } from "../../Utils/dateFormat";
import { SendEmail } from "../../Utils/sendEmail";
import user from "../../model/user.schema";
import { CovertTimeAccordingToTimeZone, isOverlap, Utils } from "../../Utils/Utils";
import { Failure } from "../../helpers/error";
import availability from "../../model/availability.schema";
import { DateTime } from "luxon";
import SMSService from "../../services/sms-service";
import { timeZoneAbbreviations } from "../../Utils/constant";
import { PromoCodeService } from "../promo-code/promoCodeService";
import { checkTrainerBookingConflict } from "../../Utils/bookingConflict";
import { scheduleInstantLessonAcceptExpiry } from "../../helpers/instantLessonExpiry";

export class TraineeService {
  public log = log.getLogger();

  public async getSlotsOfAllTrainers(query): Promise<any> {
    try {
      const {
        search = "",
        category = "",
        categories = "",
        sortBy = "name",
        onlineOnly = "",
        minRating = "",
        minHourlyRate = "",
        maxHourlyRate = "",
        page = "1",
        limit = "50",
      } = query;

      const trimmedSearch = typeof search === "string" ? search.trim() : "";
      if (trimmedSearch.length >= 2 && !isNaN(Number(trimmedSearch))) {
        return ResponseBuilder.badRequest(
          "Search must be a name or category, not a number",
          400
        );
      }

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
      const skip = (pageNum - 1) * limitNum;

      const matchStage: Record<string, unknown> = { account_type: "Trainer" };
      if (trimmedSearch.length >= 2) {
        const searchQuery = getSearchRegexQuery(
          trimmedSearch,
          CONSTANCE.USERS_SEARCH_KEYS
        );
        matchStage.$or = searchQuery.$or;
      }
      const categoryList = String(categories || category || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (categoryList.length === 1) {
        matchStage.category = { $regex: categoryList[0], $options: "i" };
      } else if (categoryList.length > 1) {
        matchStage.$and = [
          ...(Array.isArray(matchStage.$and) ? matchStage.$and : []),
          {
            $or: categoryList.map((c) => ({
              category: { $regex: c, $options: "i" },
            })),
          },
        ];
      }

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
          $match: matchStage,
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
          $addFields: {
            avgRating: {
              $cond: [
                { $gt: [{ $size: "$trainer_ratings" }, 0] },
                {
                  $avg: {
                    $map: {
                      input: "$trainer_ratings",
                      as: "r",
                      in: { $ifNull: ["$$r.ratings.trainee.sessionRating", 0] },
                    },
                  },
                },
                null,
              ],
            },
            hourly_rate: {
              $convert: {
                input: { $ifNull: ["$extraInfo.hourly_rate", 0] },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
        {
          $project: {
            _id: 1,
            available_slots: CONSTANCE.SCHEDULING_SLOTS.available_slots,
            trainer_id: "$_id",
            trainer_ratings: 1,
            avgRating: 1,
            hourly_rate: 1,
            extraInfo: 1,
            fullname: 1,
            email: 1,
            category: 1,
            profile_picture: "$profile_picture",
            stripe_account_id: 1,
            is_kyc_completed: 1,
            commission: 1,
            status: 1,
          },
        },
      ];

      const minRatingNum = parseFloat(String(minRating));
      if (Number.isFinite(minRatingNum) && minRatingNum > 0) {
        pipeline.push({ $match: { avgRating: { $gte: minRatingNum } } });
      }
      const minRateNum = parseFloat(String(minHourlyRate));
      const maxRateNum = parseFloat(String(maxHourlyRate));
      const rateMatch: Record<string, number> = {};
      if (Number.isFinite(minRateNum) && minRateNum > 0) rateMatch.$gte = minRateNum;
      if (Number.isFinite(maxRateNum) && maxRateNum > 0) rateMatch.$lte = maxRateNum;
      if (Object.keys(rateMatch).length) {
        pipeline.push({ $match: { hourly_rate: rateMatch } });
      }

      const sortKey = String(sortBy || "name").toLowerCase();
      if (sortKey === "rating") {
        pipeline.push({ $sort: { avgRating: -1, fullname: 1 } });
      } else if (sortKey === "hourly_rate" || sortKey === "rate") {
        pipeline.push({ $sort: { hourly_rate: 1, fullname: 1 } });
      } else if (sortKey === "hourly_rate_desc" || sortKey === "rate_desc") {
        pipeline.push({ $sort: { hourly_rate: -1, fullname: 1 } });
      } else {
        pipeline.push({ $sort: { fullname: 1 } });
      }

      pipeline.push({ $skip: skip }, { $limit: limitNum });

      let result = await user.aggregate(pipeline);

      if (onlineOnly === "true" || onlineOnly === "1") {
        const { isUserOnline } = require("../socket/socket.service");
        result = result.filter((row) => isUserOnline(String(row._id)));
      }

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
        (payload.charging_price == null) ||
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

      if (start_time && end_time) {
        const conflictMsg = await checkTrainerBookingConflict(payload.trainer_id, start_time, end_time);
        if (conflictMsg) return ResponseBuilder.badRequest(conflictMsg);
      }

      let promoDiscountAmount = 0;
      let appliedPromoCode: string | null = null;
      const originalPrice = Number(payload.charging_price);

      if (payload.coupon_code && typeof payload.coupon_code === "string" && payload.coupon_code.trim()) {
        const promoService = new PromoCodeService();
        const promoResult = await promoService.validatePromoCode(
          payload.coupon_code,
          _id,
          "Trainee",
          "scheduled",
          originalPrice
        );
        if (promoResult.valid) {
          promoDiscountAmount = promoResult.discount_amount!;
          appliedPromoCode = payload.coupon_code.trim().toUpperCase();
        }
      }

      const finalPrice = Number(Math.max(originalPrice - promoDiscountAmount, 0).toFixed(2));

      const bookingId = new mongoose.Types.ObjectId();
      if (payload.payment_method === "wallet" && finalPrice > 0) {
        const { walletPaymentService } = require("../wallet/walletPaymentService");
        try {
          await walletPaymentService.payFromWallet({
            traineeId: _id,
            sessionId: String(bookingId),
            trainerId: payload.trainer_id,
            amountDollars: finalPrice,
            pinSessionToken: payload.pin_session_token,
            kind: "booking",
            idempotencyKey: `book:wallet:${bookingId}`,
          });
        } catch (walletErr: any) {
          return ResponseBuilder.badRequest(walletErr?.message || "Wallet payment failed.");
        }
      }

      const sessionObj = new booked_session({
        ...payload,
        _id: bookingId,
        trainee_id: _id,
        time_zone: payload.time_zone,
        charging_price: finalPrice,
        amount: String(finalPrice),
        original_amount: String(originalPrice),
        ...(appliedPromoCode && { coupon_code: appliedPromoCode, discount_applied: promoDiscountAmount }),
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

      if (appliedPromoCode && promoDiscountAmount > 0) {
        const promoService = new PromoCodeService();
        void promoService.applyPromoCode(
          appliedPromoCode,
          _id,
          String(bookingData._id),
          promoDiscountAmount
        );
      }

      void recordUserActivityMany(
        [String(bookingData.trainee_id), String(bookingData.trainer_id)],
        UserActivityEvent.BOOKING_CREATED,
        { sessionId: String(bookingData._id), kind: "scheduled" }
      );
      await user.updateOne(
        { _id: payload.trainer_id },
        { $inc: { wallet_amount: finalPrice || 0 } }
      );

      try {
        const { WALLET_CONFIG } = require("../../config/wallet");
        if (WALLET_CONFIG.escrowEnabled && finalPrice > 0) {
          const { escrowService } = require("../wallet/escrowService");
          await escrowService.createCardEscrowRecord({
            sessionId: String(bookingData._id),
            traineeId: String(bookingData.trainee_id),
            trainerId: String(payload.trainer_id),
            grossMinor: Math.round(finalPrice * 100),
            platformFeeMinor: 0,
            fundingSource: payload.payment_intent_id ? "card" : "wallet",
            stripePaymentIntentId: payload.payment_intent_id,
            kind: "booking",
            idempotencyKey: `book:escrow:${bookingData._id}`,
          });
        }
      } catch (walletErr) {
        console.error("[BOOKING] Escrow record error:", walletErr);
      }
      
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
      // Look up the trainer to verify hourly rate and enforce payment
      const trainerDoc = await user.findById(trainer_id).select("extraInfo.hourly_rate stripe_account_id commission").lean();
      const hourlyRate = Number(trainerDoc?.extraInfo?.hourly_rate ?? 0);

      // Use server UTC "now" so instant lesson works for any trainee/trainer timezone
      const nowUtc = new Date();
      const booked_date = payload.booked_date ? new Date(payload.booked_date) : nowUtc;

      // Duration in minutes (15, 30, 60, 120). Default 30.
      const duration = durationMinutes && [15, 30, 60, 120].includes(Number(durationMinutes))
        ? Number(durationMinutes)
        : 30;

      const expectedPrice = Number(((hourlyRate / 60) * duration).toFixed(2));

      let promoDiscountAmount = 0;
      let appliedPromoCode: string | null = null;
      const promoMadeFree = payload.charging_price != null && Number(payload.charging_price) === 0;

      if (payload.coupon_code && typeof payload.coupon_code === "string" && payload.coupon_code.trim()) {
        const promoService = new PromoCodeService();
        const promoResult = await promoService.validatePromoCode(
          payload.coupon_code,
          _id,
          "Trainee",
          "instant",
          expectedPrice
        );
        if (promoResult.valid) {
          promoDiscountAmount = promoResult.discount_amount!;
          appliedPromoCode = payload.coupon_code.trim().toUpperCase();
        }
      }

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

      const conflictMsg = await checkTrainerBookingConflict(trainer_id, start_time, end_time);
      if (conflictMsg) {
        const { recordOpsEvent } = require("../ops/opsEventService");
        recordOpsEvent({
          category: "instant_lesson",
          severity: "warning",
          event_type: "INSTANT_LESSON_BOOKING_FAILED",
          user_id: _id,
          related_user_id: trainer_id,
          title: "Instant lesson booking failed",
          summary: conflictMsg,
          payload: { reason: "trainer_conflict", trainer_id },
          source: "server",
        });
        return ResponseBuilder.badRequest(conflictMsg);
      }

      const basePrice = payload.charging_price != null && payload.charging_price > 0
        ? payload.charging_price
        : expectedPrice;
      const chargingPrice = Number(Math.max(basePrice - promoDiscountAmount, 0).toFixed(2));

      const bookingFields: Record<string, any> = {
        trainer_id,
        trainee_id: _id,
        status: BOOKED_SESSIONS_STATUS.BOOKED,
        booked_date,
        session_start_time,
        session_end_time,
        start_time,
        end_time,
        is_instant: true,
      };
      if (payload.payment_intent_id) bookingFields.payment_intent_id = payload.payment_intent_id;
      if (basePrice > 0) bookingFields.original_amount = String(basePrice);
      bookingFields.amount = String(chargingPrice);
      if (appliedPromoCode) {
        bookingFields.coupon_code = appliedPromoCode;
        bookingFields.discount_applied = promoDiscountAmount;
      }

      const bookingId = new mongoose.Types.ObjectId();
      if (payload.payment_method === "wallet" && chargingPrice > 0) {
        const { walletPaymentService } = require("../wallet/walletPaymentService");
        try {
          await walletPaymentService.payFromWallet({
            traineeId: _id,
            sessionId: String(bookingId),
            trainerId: trainer_id,
            amountDollars: chargingPrice,
            pinSessionToken: payload.pin_session_token,
            kind: "booking",
            idempotencyKey: `instant:wallet:${bookingId}`,
          });
        } catch (walletErr: any) {
          return ResponseBuilder.badRequest(walletErr?.message || "Wallet payment failed.");
        }
      }

      const userObj = new booked_session({ ...bookingFields, _id: bookingId });

      const bookingData = await userObj.save();

      try {
        const { WALLET_CONFIG } = require("../../config/wallet");
        if (WALLET_CONFIG.escrowEnabled && chargingPrice > 0) {
          const { escrowService } = require("../wallet/escrowService");
          await escrowService.createCardEscrowRecord({
            sessionId: String(bookingData._id),
            traineeId: String(_id),
            trainerId: String(trainer_id),
            grossMinor: Math.round(chargingPrice * 100),
            platformFeeMinor: 0,
            fundingSource: payload.payment_intent_id ? "card" : "wallet",
            stripePaymentIntentId: payload.payment_intent_id,
            kind: "booking",
            idempotencyKey: `instant:escrow:${bookingData._id}`,
          });
        }
      } catch (walletErr) {
        console.error("[INSTANT BOOKING] Escrow record error:", walletErr);
      }

      if (appliedPromoCode && promoDiscountAmount > 0) {
        const promoService = new PromoCodeService();
        void promoService.applyPromoCode(
          appliedPromoCode,
          _id,
          String(bookingData._id),
          promoDiscountAmount
        );
      }

      void recordUserActivityMany(
        [String(bookingData.trainee_id), String(bookingData.trainer_id)],
        UserActivityEvent.BOOKING_CREATED,
        { sessionId: String(bookingData._id), kind: "instant" }
      );

      void availability.updateMany(
        {
          trainer_id,
          status: false,
          start_time: { $lt: end_time },
          end_time: { $gt: start_time },
        },
        { $set: { status: true } }
      ).catch((e) => console.error("[BOOKING] Error marking availability:", e));

      scheduleInstantLessonAcceptExpiry(
        String(bookingData._id),
        String(trainer_id),
        String(_id),
        bookingData.createdAt ? new Date(bookingData.createdAt) : new Date()
      );

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
      const { recordOpsEvent } = require("../ops/opsEventService");
      recordOpsEvent({
        category: "instant_lesson",
        severity: "error",
        event_type: "INSTANT_LESSON_BOOKING_FAILED",
        user_id: _id,
        related_user_id: trainer_id,
        title: "Instant lesson booking error",
        summary: err?.message || String(err),
        payload: { trainer_id },
        source: "server",
      });
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
