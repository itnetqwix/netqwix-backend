import { Response, Request } from "express";
import { log } from "../../../logger";
import {
  CONSTANCE,
  NetquixImage,
  SessionReminderMinutes,
  UPDATE_FIELDS,
} from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { TraineeService } from "./traineeService";
import { SessionExtensionService } from "./sessionExtensionService";
import { bookSessionModal } from "./traineeValidator";
import * as _ from "lodash";
import { TrainerService } from "../trainer/trainerService";
import { DateTime } from "luxon";
const schedule = require("node-schedule");
import { SendEmail } from "../../Utils/sendEmail";
import user from "../../model/user.schema";
import * as cron from "node-cron";
import SMSService from "../../services/sms-service";
import { CovertTimeAccordingToTimeZone, getIceServerCredentials } from "../../Utils/Utils";
import { timeZoneAbbreviations } from "../../Utils/constant";
import axios from "axios";
import booked_session from "../../model/booked_sessions.schema";

export class traineeController {
  public logger = log.getLogger();
  public traineeService = new TraineeService();
  public trainerService = new TrainerService();
  public sessionExtensionService = new SessionExtensionService();

  public getSlotsOfAllTrainers = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder =
        await this.traineeService.getSlotsOfAllTrainers(req.query);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public bookSession = async (req: Request, res: Response) => {
    try {
      const { body } = req;
      const result: ResponseBuilder = await this.traineeService.bookSession(
        body,
        req["authUser"]["_id"]
      );
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }

      if (req?.body?.slot_id) {
        await this.trainerService.updateStot({
          _id: req?.body?.slot_id,
          status: true,
        });
      } else {
        var date = new Date(body?.booked_date).toISOString().split("T")[0];
        var dateArr = date?.split("-");
        var start_time = body?.session_start_time;
        var end_time = body?.session_end_time;

        let start_time_date = new Date(
          Number(dateArr[0]),
          Number(dateArr[1]) - 1,
          Number(dateArr[2]),
          Number(start_time.split(":")[0]),
          Number(start_time.split(":")[1]),
          0,
          0
        ).toISOString();
        let end_time_date = new Date(
          Number(dateArr[0]),
          Number(dateArr[1]) - 1,
          Number(dateArr[2]),
          Number(end_time.split(":")[0]),
          Number(end_time.split(":")[1]),
          0,
          0
        ).toISOString();

        await this.trainerService.updateManyStot(
          {
            $and: [
              {
                $or: [
                  {
                    start_time: {
                      $gt: start_time_date,
                      $lt: end_time_date,
                    },
                  },
                  {
                    end_time: {
                      $gt: start_time_date,
                      $lt: end_time_date,
                    },
                  },
                ],
              },
              {
                trainer_id: body?.trainer_id,
              },
            ],
          },
          { $set: { status: true } }
        );
      }

      const trainee = await user.findById(result.result.trainee_id);
      const trainer = await user.findById(result.result.trainer_id);

      if (!trainee || !trainer) {
        return console.error("User not found.");
      }

      const startTime = CovertTimeAccordingToTimeZone(result.result.start_time, { to: "utc", from: result.result.time_zone });

      const runTime = startTime.minus({ minutes: 5 });

      if (!trainee.isPrivate && !trainer.isPrivate) {
        if (!trainee.friends.includes(trainer._id)) {
          trainee.friends.push(trainer._id);
        }
        if (!trainer.friends.includes(trainee._id)) {
          trainer.friends.push(trainee._id);
        }

        await trainee.save();
        await trainer.save();
      }

      const cronTime = `${runTime.minute} ${runTime.hour} ${runTime.day} ${runTime.month} *`;

      const meetingLink = process.env.FRONTEND_URL_SMS + "/meeting?id="

      if (
        trainer.extraInfo.availabilityInfo.timeZone === result.result.time_zone
      ) {
        cron.schedule(cronTime, async () => {
          try {
            const iceServers = await getIceServerCredentials()
            const session = await booked_session.findByIdAndUpdate(result.result._id,{
              iceServers
            })
            await session.save()
            if (!trainee || !trainer) {
              return console.error("User not found.");
            }

            const startTime = DateTime.fromJSDate(result.result.start_time, { zone: 'utc' })
            const formattedTime = `${startTime.toFormat("EEEE, MMMM d'th' h:mm a")} ${timeZoneAbbreviations[result.result.time_zone] || result.result.time_zone}`
            // const formattedTime = startTime.toFormat("cccc, LLL dd'th' h:mm a ZZZZ");

            // Send emails to both the trainee and trainer
            if (trainee.notifications.transactional.email) {


              SendEmail.sendRawEmail(
                "5-min-remainder",
                {
                  "{TRAINER/TRAINEE NAME}": trainer.fullname,
                  "{MEETING_LINK}": meetingLink + result.result._id,
                  "{SESSION_TIME}": formattedTime
                },
                [trainee.email],
                `Reminder: Your session with ${trainer.fullname} starts in 5 minutes!!`,
              );
            }

            const covertedBookedTime = CovertTimeAccordingToTimeZone(
              result.result.booked_date,
              {
                to: trainer.extraInfo.availabilityInfo.timeZone,
                from: result.result.time_zone,
              }
            );

            if (trainer.notifications.transactional.email) {
              SendEmail.sendRawEmail(
                "5-min-remainder",
                {
                  "{TRAINER/TRAINEE NAME}": trainee.fullname,
                  "{MEETING_LINK}": meetingLink + result.result._id,
                  "{SESSION_TIME}": formattedTime
                },
                [trainer.email],
                `Reminder: Your session with ${trainee.fullname} starts in 5 minutes!!`,
              );
            }
            const smsService = new SMSService();
            if (trainer.notifications.transactional.sms) {

              await smsService.sendSMS(
                trainer.mobile_no,
                `REMINDER: Your NetQwix Training Session Starts in ${SessionReminderMinutes.FIVE} minutes` +
                " With " +
                trainee.fullname + `. Join with this link ${meetingLink + result.result._id}`
              );
            }
            if (trainee.notifications.transactional.sms) {

              await smsService.sendSMS(
                trainee.mobile_no,
                `REMINDER: Your NetQwix Training Session Starts in ${SessionReminderMinutes.FIVE} minutes` +
                " With " +
                trainer.fullname + `. Join with this link ${meetingLink + result.result._id}`
              );
            }
          } catch (err) {
            console.error("Error running cron job:", err);
          }
        });
      } else {
        cron.schedule(cronTime, async () => {
          try {
            const iceServers = await getIceServerCredentials()
            const session = await booked_session.findByIdAndUpdate(result.result._id,{
              iceServers
            })
            await session.save()
            const sessionStartTime = startTime.toJSDate()

            // Send emails to both the trainee and trainer
            if (trainee.notifications.transactional.email) {
              const startTime = DateTime.fromJSDate(sessionStartTime, { zone: 'utc' })
              const traineeFormattedTime = `${startTime.toFormat("EEEE, MMMM d'th' h:mm a")} ${timeZoneAbbreviations[result.result.time_zone] || result.result.time_zone}`

              SendEmail.sendRawEmail(
                "5-min-remainder",
                {
                  "{TRAINER/TRAINEE NAME}": trainer.fullname,
                  "{MEETING_LINK}": meetingLink + result.result._id,
                  "{SESSION_TIME}": traineeFormattedTime
                },
                [trainee.email],
                `Reminder: Your session with ${trainer.fullname} starts in 5 minutes!!`,
              );
            }
            const covertedBookedTime = CovertTimeAccordingToTimeZone(
              result.result.booked_date,
              {
                to: trainer.extraInfo.availabilityInfo.timeZone,
                from: result.result.time_zone,
              }
            );
            if (trainer.notifications.transactional.email) {
              const startTime = DateTime.fromJSDate(sessionStartTime, { zone: 'utc' })
              const trainerFormattedTime = `${startTime.toFormat("EEEE, MMMM d'th' h:mm a")} ${timeZoneAbbreviations[trainer.extraInfo.availabilityInfo.timeZone] || trainer.extraInfo.availabilityInfo.timeZone}`

              SendEmail.sendRawEmail(
                "5-min-remainder",
                {
                  "{TRAINER/TRAINEE NAME}": trainee.fullname,
                  "{MEETING_LINK}": meetingLink + result.result._id,
                  "{SESSION_TIME}": trainerFormattedTime
                },
                [trainer.email],
                `Reminder: Your session with ${trainee.fullname} starts in 5 minutes!!`,
              );
            }

            const smsService = new SMSService();
            if (trainer.notifications.transactional.sms) {

              await smsService.sendSMS(
                trainer.mobile_no,
                `REMINDER: Your NetQwix Training Session Starts in ${SessionReminderMinutes.FIVE} minutes` +
                " With " +
                trainee.fullname + `. Join with this link ${meetingLink + result.result._id}`
              );
            }
            if (trainee.notifications.transactional.sms) {

              await smsService.sendSMS(
                trainee.mobile_no,
                `REMINDER: Your NetQwix Training Session Starts in ${SessionReminderMinutes.FIVE} minutes` +
                " With " +
                trainer.fullname + `. Join with this link ${meetingLink + result.result._id}`
              );
            }
          } catch (err) {
            console.error("Error running cron job:", err);
          }
        });
      }

      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code || 500)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public bookInstantMeeting = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder =
        await this.traineeService.bookInstantMeeting(
          req["body"],
          req["authUser"]["_id"]
        );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateProfile = async (req: any, res: Response) => {
    try {
      const payload = _.pick(req.body, UPDATE_FIELDS.user);
      const result: ResponseBuilder = await this.traineeService.updateProfile(
        payload,
        req.authUser
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code)
        .send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public checkSlotExist = async (req: Request, res: Response) => {
    try {
      const result: ResponseBuilder = await this.traineeService.checkSlotExist(
        req.body
      );
      const requestedDate = req.body.booked_date; // Assuming booked_date is a string in "YYYY-MM-DD" format
      const today = new Date().toISOString().split("T")[0]; // Format today's date as "YYYY-MM-DD"

      // Filter out past slots if the request is for today's date
      // Filter out past slots if the request is for today's date
      if (requestedDate === today) {
        const currentTime = new Date();

        result.result.availableSlots = result.result.availableSlots.filter(
          (slot: { start: string; end: string }) => {
            // Create a Date object for the slot's start time on today's date
            const slotStartTime = new Date(`${requestedDate}T${slot.start}:00`); // Assuming time format "HH:MM"

            // Only keep slots where the start time is later than the current time
            return slotStartTime > currentTime;
          }
        );
      }

      if (result.status === CONSTANCE.FAIL) {
        return res.status(result?.code || 404).send({ message: result.error });
      }
      return res
        .status(result?.code || 200)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res
        .status(err.code || 500)
        .send({ status: CONSTANCE.FAIL, error: err });
    }
  };

  public recentTrainers = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.trainerService.recentTrainers(
        req?.authUser._id
      );
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(err.code || 500).send({
        status: CONSTANCE.FAIL,
        error: err.message || "Internal Server Error",
      });
    }
  };

  public getSessionExtensionQuote = async (req: any, res: Response) => {
    try {
      const sessionId = String(req.query.sessionId ?? "");
      const minutes = Number(req.query.minutes);
      if (!sessionId || !Number.isFinite(minutes)) {
        return res.status(400).send({
          status: CONSTANCE.FAIL,
          error: "sessionId and minutes are required",
        });
      }
      const result = await this.sessionExtensionService.getQuote(
        sessionId,
        minutes,
        String(req.authUser._id)
      );
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ message: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public createSessionExtensionPaymentIntent = async (req: Request, res: Response) => {
    try {
      const result = await this.sessionExtensionService.createPaymentIntent({
        ...req.body,
        _userId: String(req["authUser"]?._id),
        _userType: req["authUser"]?.account_type,
      });
      if (result.code === 400) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: result.error });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public confirmSessionExtension = async (req: Request, res: Response) => {
    try {
      const result = await this.sessionExtensionService.confirmExtension({
        sessionId: req.body.sessionId,
        minutes: Number(req.body.minutes),
        payment_intent_id: req.body.payment_intent_id,
        payment_method: req.body.payment_method,
        pin_session_token: req.body.pin_session_token,
        _userId: String(req["authUser"]?._id),
      });
      if (result.code === 400 || result.code === 409) {
        return res.status(result.code).send({
          status: CONSTANCE.FAIL,
          error: result.error || result.result,
        });
      }
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };
}
