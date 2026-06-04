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
import {
  checkBothPartiesBookingConflict,
} from "../../Utils/bookingConflict";
import {
  resolveScheduledUtcWindow,
  validateScheduledBookWindow,
} from "../../helpers/booking/scheduledBookingValidation";
import { scheduleInstantLessonAcceptExpiry } from "../../helpers/instantLessonExpiry";
import {
  computeInstantReservationWindowMs,
  INSTANT_PHASE,
  isInstantAllowedDuration,
} from "../../config/instantLesson";
import { instantEligibilityService } from "./instantEligibilityService";
import {
  cacheGetOrSet,
  invalidateUserSessionsCache,
  trainerSlotsCacheKey,
} from "../../services/cacheService";
import { REDIS_TTL } from "../../config/redis";
import { withDistributedLock } from "../../services/distributedLock";
import trainee_favorite_trainers from "../../model/trainee_favorite_trainers.schema";
import {
  computeTodaySlotsPreviewFromAvailability,
  type TrainerBookingWindow,
} from "../../helpers/trainerTodaySlotsPreview";
import { attachTrainerSocialSignals } from "./traineeSocialSignals";
import {
  buildTrainerDirectoryMatchStage,
  mongoMatchTrainerVisibleToTrainees,
  parseTrainerCategoryFilterList,
} from "../../helpers/trainerListingMatch";

export class TraineeService {
  public log = log.getLogger();

  public attachTrainerSocialSignals = attachTrainerSocialSignals;

  public async getSlotsOfAllTrainers(query): Promise<any> {
    const trimmedSearch =
      typeof query?.search === "string" ? query.search.trim() : "";
    if (trimmedSearch.length >= 2 && !isNaN(Number(trimmedSearch))) {
      return ResponseBuilder.badRequest(
        "Search must be a name or category, not a number",
        400
      );
    }
    const cacheKey = trainerSlotsCacheKey(query as Record<string, unknown>);
    try {
      const enriched = await cacheGetOrSet(
        cacheKey,
        REDIS_TTL.TRAINER_SLOTS_SEC,
        () => this.loadSlotsOfAllTrainers(query)
      );
      return ResponseBuilder.data(enriched, l10n.t("GET_ALL_SLOTS"));
    } catch (err) {
      console.error(`Error getting slots of all trainers:`, err);
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  private async loadSlotsOfAllTrainers(query): Promise<any[]> {
      const {
        search = "",
        category = "",
        categories = "",
        sortBy = "name",
        onlineOnly = "",
        hasSlotsOnly = "",
        minRating = "",
        minHourlyRate = "",
        maxHourlyRate = "",
        page = "1",
        limit = "50",
        traineeTimeZone: traineeTimeZoneRaw = "",
      } = query;

      const traineeTimeZone =
        typeof traineeTimeZoneRaw === "string" && traineeTimeZoneRaw.trim()
          ? traineeTimeZoneRaw.trim()
          : "UTC";
      const todayIso = DateTime.now().setZone(traineeTimeZone).toISODate()!;

      const trimmedSearch = typeof search === "string" ? search.trim() : "";

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
      const skip = (pageNum - 1) * limitNum;

      const categoryList = parseTrainerCategoryFilterList(categories, category);
      let searchOr: Record<string, unknown>[] | undefined;
      if (trimmedSearch.length >= 2) {
        const searchQuery = getSearchRegexQuery(
          trimmedSearch,
          CONSTANCE.USERS_SEARCH_KEYS
        );
        searchOr = searchQuery.$or;
      }
      const matchStage = buildTrainerDirectoryMatchStage({
        searchOr,
        categoryList,
      });

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
            trainer_id: "$_id",
            trainer_ratings: 1,
            avgRating: 1,
            reviewCount: { $size: { $ifNull: ["$trainer_ratings", []] } },
            completedSessionCount: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$trainer_ratings", []] },
                  as: "r",
                  cond: {
                    $in: [
                      { $toLower: { $ifNull: ["$$r.status", ""] } },
                      ["completed", "confirm", "confirmed"],
                    ],
                  },
                },
              },
            },
            isVerified: {
              $cond: {
                if: {
                  $and: [
                    { $eq: ["$status", "approved"] },
                    {
                      $or: [
                        {
                          $eq: [
                            "$trainer_verification.onboarding_step",
                            "completed",
                          ],
                        },
                        {
                          $and: [
                            {
                              $in: [
                                "$trainer_verification.onboarding_step",
                                ["account_created", null],
                              ],
                            },
                            {
                              $eq: [
                                {
                                  $ifNull: [
                                    "$trainer_verification.submitted_for_review_at",
                                    null,
                                  ],
                                },
                                null,
                              ],
                            },
                          ],
                        },
                        { $eq: ["$trainer_verification", null] },
                        {
                          $eq: [
                            { $type: "$trainer_verification" },
                            "missing",
                          ],
                        },
                      ],
                    },
                  ],
                },
                then: true,
                else: false,
              },
            },
            hourly_rate: 1,
            extraInfo: 1,
            fullname: 1,
            email: 1,
            category: 1,
            profile_picture: "$profile_picture",
            trainer_verification: 1,
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
      } else if (sortKey === "next_available") {
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

      const { isUserOnline } = require("../socket/socket.service");
      const { isTrainerInWeeklyAvailabilityNow } = require("./instantEligibilityService");

      const trainerIds = result.map((row: any) => row._id).filter(Boolean);
      const bookingsByTrainer = await this.loadTrainerBookingsForDate(
        trainerIds,
        todayIso
      );

      const enriched = await Promise.all(
        result.map(async (row: any) => {
          const trainerId = String(row._id || row.trainer_id);
          const inAvail = await isTrainerInWeeklyAvailabilityNow(trainerId);
          const tz =
            row.extraInfo?.availabilityInfo?.timeZone ||
            (row as { time_zone?: string }).time_zone ||
            inAvail.timezone;
          const trainerBookings =
            bookingsByTrainer.get(trainerId) ?? ([] as TrainerBookingWindow[]);
          const todayPreview = computeTodaySlotsPreviewFromAvailability(
            row.extraInfo as Record<string, unknown> | undefined,
            todayIso,
            traineeTimeZone,
            trainerBookings,
            3
          );
          return {
            ...row,
            today_slots_count: todayPreview.count,
            today_slot_previews: todayPreview.previews,
            slots: todayPreview.previews.map((time) => ({
              start_time: time,
              label: "Today",
            })),
            is_online: isUserOnline(trainerId),
            in_availability_now: inAvail.ok,
            trainer_timezone: tz,
            has_open_slots: todayPreview.hasOpenSlots,
          };
        })
      );

      let out = enriched;
      if (hasSlotsOnly === "true" || hasSlotsOnly === "1") {
        out = out.filter((row) => row.has_open_slots);
      }
      if (sortKey === "next_available") {
        out = [...out].sort((a, b) => {
          const aSlots = a.has_open_slots ? 1 : 0;
          const bSlots = b.has_open_slots ? 1 : 0;
          if (bSlots !== aSlots) return bSlots - aSlots;
          return (b.avgRating ?? 0) - (a.avgRating ?? 0);
        });
      }

      return out;
  }

  /** Active bookings on `bookedDateIso` (YYYY-MM-DD) for directory slot previews. */
  private async loadTrainerBookingsForDate(
    trainerIds: mongoose.Types.ObjectId[],
    bookedDateIso: string
  ): Promise<Map<string, TrainerBookingWindow[]>> {
    const map = new Map<string, TrainerBookingWindow[]>();
    if (!trainerIds.length) return map;

    const dateOnly = bookedDateIso.split("T")[0];
    const rows = await booked_session
      .find({
        trainer_id: { $in: trainerIds },
        status: { $ne: BOOKED_SESSIONS_STATUS.cancel },
        $expr: {
          $eq: [
            { $dateToString: { format: "%Y-%m-%d", date: "$booked_date" } },
            dateOnly,
          ],
        },
      })
      .select("trainer_id start_time end_time time_zone")
      .lean();

    for (const row of rows) {
      const tid = String(row.trainer_id);
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid)!.push({
        start: row.start_time,
        end: row.end_time,
        time_zone: row.time_zone,
      });
    }
    return map;
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
    const lockKey = `book:${payload?.trainer_id}:${payload?.booked_date}:${payload?.session_start_time}`;
    try {
      return await withDistributedLock(lockKey, () =>
        this.bookSessionCore(payload, _id)
      );
    } catch (err: any) {
      if (err?.message === "RESOURCE_LOCKED") {
        return ResponseBuilder.badRequest(
          "This slot is being booked by another user. Please try again.",
          409
        );
      }
      throw err;
    }
  }

  private async bookSessionCore(
    payload: bookSessionModal,
    _id: string
  ): Promise<ResponseBuilder> {
    try {
      const validation = validateScheduledBookWindow(payload);
      if (validation.ok === false) {
        return ResponseBuilder.badRequest(
          validation.message,
          validation.httpCode ?? 400
        );
      }
      const window = resolveScheduledUtcWindow(payload);
      if (!window) {
        return ResponseBuilder.badRequest(
          "Could not resolve session start and end times. Check date, times, and timezone.",
          400
        );
      }
      const { start_time, end_time } = window;
      const conflictMsg = await checkBothPartiesBookingConflict(
        payload.trainer_id,
        _id,
        start_time,
        end_time
      );
      if (conflictMsg) {
        return ResponseBuilder.badRequest(conflictMsg, 409);
      }

      const {
        computeScheduledDurationMinutes,
      } = require("../../helpers/sessionAccess");
      const trainerRateDoc = await user
        .findById(payload.trainer_id)
        .select("extraInfo.hourly_rate")
        .lean();
      const hourlyRate = Number(trainerRateDoc?.extraInfo?.hourly_rate ?? 0);
      const durationMins = computeScheduledDurationMinutes(
        String(payload.session_start_time),
        String(payload.session_end_time)
      );
      const expectedPrice = Number(((hourlyRate / 60) * durationMins).toFixed(2));
      const originalPrice = Number(payload.charging_price);
      if (hourlyRate > 0 && durationMins > 0) {
        const priceDelta = Math.abs(originalPrice - expectedPrice);
        if (priceDelta > 0.02) {
          return ResponseBuilder.badRequest(
            "Session price does not match the trainer rate for the selected duration.",
            400
          );
        }
      }

      const { computeBookingCheckoutDiscounts, markReferralFirstLessonDiscountUsed } =
        require("../referral/referralCheckoutDiscount");
      const checkout = await computeBookingCheckoutDiscounts({
        traineeId: String(_id),
        originalPrice,
        bookingType: "scheduled",
        couponCode: payload.coupon_code,
        trainerId: payload.trainer_id ? String(payload.trainer_id) : undefined,
      });
      if (checkout.promoError) {
        return ResponseBuilder.badRequest(checkout.promoError);
      }
      const promoDiscountAmount = checkout.promoDiscount;
      const referralDiscountAmount = checkout.referralDiscount;
      const appliedPromoCode = checkout.appliedPromoCode;
      const finalPrice = checkout.finalPrice;

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
            quoteId: (payload as any).quote_id,
            billingAddress: (payload as any).billing_address,
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
        ...(appliedPromoCode && { coupon_code: appliedPromoCode }),
        ...(checkout.promoSponsorType && {
          promo_sponsor_type: checkout.promoSponsorType,
        }),
        promo_discount_applied: promoDiscountAmount,
        discount_applied: checkout.totalDiscount,
        ...(referralDiscountAmount > 0 && {
          referral_discount_applied: referralDiscountAmount,
        }),
        ...(start_time && { start_time }),
        ...(end_time && { end_time }),
      });
      if (checkout.referralAttributionId && referralDiscountAmount > 0) {
        void markReferralFirstLessonDiscountUsed(
          checkout.referralAttributionId,
          referralDiscountAmount,
          String(bookingId)
        );
      }
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
      let bookingData;
      try {
        bookingData = await sessionObj.save();
      } catch (saveErr) {
        if (payload.payment_method === "wallet" && finalPrice > 0) {
          try {
            const { walletPaymentService } = require("../wallet/walletPaymentService");
            await walletPaymentService.refundWalletPaymentForSession({
              sessionId: String(bookingId),
              traineeId: String(_id),
              kind: "booking",
              idempotencyKey: `book:wallet:${bookingId}`,
              reason: "booking_save_failed",
            });
          } catch (rollbackErr) {
            console.error("[BOOKING] Wallet rollback after save failure:", rollbackErr);
          }
        }
        throw saveErr;
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
        { sessionId: String(bookingData._id), kind: "scheduled" }
      );
      await user.updateOne(
        { _id: payload.trainer_id },
        { $inc: { wallet_amount: finalPrice || 0 } }
      );

      try {
        const { WALLET_CONFIG } = require("../../config/wallet");
        const paidByWallet = payload.payment_method === "wallet";
        const paidByCardPi = !!payload.payment_intent_id;
        /** Wallet path already creates a hold via payFromWallet; card PI is handled by Stripe webhook. */
        if (WALLET_CONFIG.escrowEnabled && finalPrice > 0 && !paidByWallet && !paidByCardPi) {
          const { escrowService } = require("../wallet/escrowService");
          await escrowService.createCardEscrowRecord({
            sessionId: String(bookingData._id),
            traineeId: String(bookingData.trainee_id),
            trainerId: String(payload.trainer_id),
            grossMinor: Math.round(finalPrice * 100),
            platformFeeMinor: 0,
            fundingSource: "card",
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

      void invalidateUserSessionsCache(String(_id));
      void invalidateUserSessionsCache(String(payload.trainer_id));
      
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

  public async getInstantLessonEligibility(
    trainerId: string,
    traineeId: string,
    durationMinutes: number
  ): Promise<ResponseBuilder> {
    const result = await instantEligibilityService.checkInstantLessonEligibility({
      trainerId,
      traineeId,
      durationMinutes: Number(durationMinutes) || 30,
    });
    return ResponseBuilder.data(result, "Instant lesson eligibility");
  }

  /**
   * Book an instant meeting. Trainer must be online, available, and in weekly slot;
   * both parties must have a clear reservation window (lesson + accept + join + buffer).
   */
  public async bookInstantMeeting(
    payload: bookInstantMeetingModal,
    _id: string
  ): Promise<ResponseBuilder> {
    const { trainer_id, duration: durationMinutes } = payload;
    try {
      const duration = durationMinutes && isInstantAllowedDuration(Number(durationMinutes))
        ? Number(durationMinutes)
        : 30;

      if (!isInstantAllowedDuration(duration)) {
        return ResponseBuilder.badRequest(
          "Instant lessons are only available for 15 or 30 minutes."
        );
      }

      const eligibility = await instantEligibilityService.checkInstantLessonEligibility({
        trainerId: trainer_id,
        traineeId: _id,
        durationMinutes: duration,
      });
      if (!eligibility.eligible) {
        const { recordOpsEvent } = require("../ops/opsEventService");
        recordOpsEvent({
          category: "instant_lesson",
          severity: "warning",
          event_type: "INSTANT_LESSON_ELIGIBILITY_DENIED",
          user_id: _id,
          related_user_id: trainer_id,
          title: "Instant lesson not eligible",
          summary: eligibility.reasons.join(" "),
          payload: { reasons: eligibility.reasons, duration },
          source: "server",
        });
        return ResponseBuilder.badRequest(eligibility.reasons.join(" "));
      }

      // Look up the trainer to verify hourly rate and enforce payment
      const trainerDoc = await user.findById(trainer_id).select("extraInfo.hourly_rate stripe_account_id commission").lean();
      const hourlyRate = Number(trainerDoc?.extraInfo?.hourly_rate ?? 0);

      const nowUtc = new Date();
      const booked_date = payload.booked_date ? new Date(payload.booked_date) : nowUtc;
      const requestedAt = nowUtc;
      const acceptDeadlineAt = new Date(
        requestedAt.getTime() + 2 * 60 * 1000
      );
      const reservationMs = computeInstantReservationWindowMs(duration);

      const expectedPrice = Number(((hourlyRate / 60) * duration).toFixed(2));

      const { computeBookingCheckoutDiscounts, markReferralFirstLessonDiscountUsed } =
        require("../referral/referralCheckoutDiscount");
      const checkout = await computeBookingCheckoutDiscounts({
        traineeId: String(_id),
        originalPrice: expectedPrice,
        bookingType: "instant",
        couponCode: payload.coupon_code,
        trainerId: trainer_id ? String(trainer_id) : undefined,
      });
      if (checkout.promoError) {
        return ResponseBuilder.badRequest(checkout.promoError);
      }
      const promoDiscountAmount = checkout.promoDiscount;
      const referralDiscountAmount = checkout.referralDiscount;
      const appliedPromoCode = checkout.appliedPromoCode;

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

      const start_time = new Date(booked_date);
      const end_time = new Date(start_time.getTime() + reservationMs);

      const conflictMsg = await checkBothPartiesBookingConflict(
        trainer_id,
        _id,
        start_time,
        end_time
      );
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
        return ResponseBuilder.badRequest(conflictMsg, 409);
      }

      /** Pre-discount list price; never use a post-payment / post-promo client amount as the base. */
      const basePrice = expectedPrice;
      const chargingPrice = checkout.finalPrice;

      if (chargingPrice > 0 && hourlyRate > 0) {
        const paidViaCard = Boolean(payload.payment_intent_id);
        const paidViaWallet = payload.payment_method === "wallet";
        if (!paidViaCard && !paidViaWallet) {
          return ResponseBuilder.badRequest(
            "Payment is required before booking. Complete payment or apply a valid promo code."
          );
        }
      }

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
        duration_minutes: duration,
        instant_phase: INSTANT_PHASE.PENDING_ACCEPT,
        requested_at: requestedAt,
        accept_deadline_at: acceptDeadlineAt,
      };
      if (payload.payment_intent_id) bookingFields.payment_intent_id = payload.payment_intent_id;
      if (basePrice > 0) bookingFields.original_amount = String(basePrice);
      bookingFields.amount = String(chargingPrice);
      if (checkout.totalDiscount > 0) {
        bookingFields.discount_applied = checkout.totalDiscount;
      }
      if (appliedPromoCode) bookingFields.coupon_code = appliedPromoCode;
      if (checkout.promoSponsorType) {
        bookingFields.promo_sponsor_type = checkout.promoSponsorType;
      }
      if (promoDiscountAmount > 0) {
        bookingFields.promo_discount_applied = promoDiscountAmount;
      }
      if (referralDiscountAmount > 0) {
        bookingFields.referral_discount_applied = referralDiscountAmount;
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
            quoteId: (payload as any).quote_id,
            billingAddress: (payload as any).billing_address,
          });
        } catch (walletErr: any) {
          return ResponseBuilder.badRequest(walletErr?.message || "Wallet payment failed.");
        }
      }

      const userObj = new booked_session({ ...bookingFields, _id: bookingId });

      let bookingData;
      try {
        bookingData = await userObj.save();
      } catch (saveErr) {
        if (payload.payment_method === "wallet" && chargingPrice > 0) {
          try {
            const { walletPaymentService } = require("../wallet/walletPaymentService");
            await walletPaymentService.refundWalletPaymentForSession({
              sessionId: String(bookingId),
              traineeId: String(_id),
              kind: "booking",
              idempotencyKey: `instant:wallet:${bookingId}`,
              reason: "instant_booking_save_failed",
            });
          } catch (rollbackErr) {
            console.error("[INSTANT BOOKING] Wallet rollback after save failure:", rollbackErr);
          }
        }
        throw saveErr;
      }

      try {
        const { WALLET_CONFIG } = require("../../config/wallet");
        const paidByWallet = payload.payment_method === "wallet";
        const paidByCardPi = !!payload.payment_intent_id;
        if (WALLET_CONFIG.escrowEnabled && chargingPrice > 0 && !paidByWallet && !paidByCardPi) {
          const { escrowService } = require("../wallet/escrowService");
          await escrowService.createCardEscrowRecord({
            sessionId: String(bookingData._id),
            traineeId: String(_id),
            trainerId: String(trainer_id),
            grossMinor: Math.round(chargingPrice * 100),
            platformFeeMinor: 0,
            fundingSource: "card",
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
      if (checkout.referralAttributionId && referralDiscountAmount > 0) {
        void markReferralFirstLessonDiscountUsed(
          checkout.referralAttributionId,
          referralDiscountAmount,
          String(bookingData._id)
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
        requestedAt
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
        {
          bookingId: bookingData._id,
          booking: bookingData,
          acceptDeadlineAt: acceptDeadlineAt.toISOString(),
          totalWindowMinutes: eligibility.totalWindowMinutes,
          instantPhase: INSTANT_PHASE.PENDING_ACCEPT,
        },
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

  public async listFavoriteTrainers(traineeId: string): Promise<ResponseBuilder> {
    try {
      const rows = await trainee_favorite_trainers
        .find({ trainee_id: new mongoose.Types.ObjectId(traineeId) })
        .sort({ createdAt: -1 })
        .lean();
      const trainerIds = rows.map((r) => r.trainer_id);
      if (!trainerIds.length) {
        return ResponseBuilder.data([], l10n.t("GET_ALL_SLOTS"));
      }
      const trainers = await user
        .find({
          $and: [{ _id: { $in: trainerIds } }, mongoMatchTrainerVisibleToTrainees()],
        })
        .select(
          "fullname profile_picture category avgRating status trainer_verification extraInfo"
        )
        .lean();
      const order = new Map(trainerIds.map((id, i) => [String(id), i]));
      trainers.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
      );
      return ResponseBuilder.data(trainers, l10n.t("GET_ALL_SLOTS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async addFavoriteTrainer(
    traineeId: string,
    trainerId: string
  ): Promise<ResponseBuilder> {
    try {
      if (!isValidMongoObjectId(trainerId)) {
        return ResponseBuilder.errorMessage("Invalid trainer id");
      }
      const trainer = await user
        .findOne({ _id: trainerId, account_type: "Trainer" })
        .select("_id")
        .lean();
      if (!trainer) {
        return ResponseBuilder.errorMessage("Trainer not found");
      }
      await trainee_favorite_trainers.findOneAndUpdate(
        {
          trainee_id: new mongoose.Types.ObjectId(traineeId),
          trainer_id: new mongoose.Types.ObjectId(trainerId),
        },
        {},
        { upsert: true, new: true }
      );
      return ResponseBuilder.data({ trainerId }, l10n.t("GET_ALL_SLOTS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async removeFavoriteTrainer(
    traineeId: string,
    trainerId: string
  ): Promise<ResponseBuilder> {
    try {
      await trainee_favorite_trainers.deleteOne({
        trainee_id: new mongoose.Types.ObjectId(traineeId),
        trainer_id: new mongoose.Types.ObjectId(trainerId),
      });
      return ResponseBuilder.data({ trainerId }, l10n.t("GET_ALL_SLOTS"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
}
