import mongoose from "mongoose";
import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { ChatService } from "../chat/chatService";
import { NotificationsService } from "../notifications/notificationsService";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";

/**
 * "Bring-back" automation. Trainers can fire a templated message to
 * trainees they haven't seen in a while — keeps the relationship warm
 * without forcing them to type out the same DM ten times.
 *
 * Two surfaces:
 *  1. `listInactiveCandidates` returns trainees with no completed/upcoming
 *     session in the last 14 days, so the dashboard can highlight a
 *     "haven't trained with you in a while" list.
 *  2. `sendNudge` posts a templated chat message + push notification on
 *     the trainer's behalf. The trainer can also override the templated
 *     body with their own copy.
 */

const NUDGE_RATE = new Map<string, number>();
const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS_THRESHOLD = 14;

type NudgeTemplate = "comeback" | "checkin" | "promo";

function templateFor(
  template: NudgeTemplate,
  trainerName: string,
  traineeName: string,
  daysSince: number
): string {
  const firstName = traineeName.split(" ")[0] || "there";
  switch (template) {
    case "checkin":
      return `Hey ${firstName}, just checking in. How are you feeling about your training lately? Happy to map out a session whenever you're ready. — ${trainerName}`;
    case "promo":
      return `Hi ${firstName}! Carving out time this week for a couple of comeback sessions. Want me to hold a slot for you? — ${trainerName}`;
    case "comeback":
    default:
      return `Hey ${firstName}, haven't seen you in ${daysSince} day${daysSince === 1 ? "" : "s"}. Up for picking back up where we left off? Reply with a time that works and I'll lock it in. — ${trainerName}`;
  }
}

export class TraineeNudgeService {
  public log = log.getLogger();
  private chat = new ChatService();
  private push = new NotificationsService();

  async listInactiveCandidates(trainerId: string): Promise<ResponseBuilder> {
    if (!mongoose.isValidObjectId(trainerId)) {
      return ResponseBuilder.badRequest("Invalid trainer id");
    }

    const trainerObj = new mongoose.Types.ObjectId(trainerId);
    const cutoff = new Date(
      Date.now() - INACTIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000
    );

    /**
     * Every trainee this trainer has ever had a confirmed/completed
     * session with, EXCEPT those who have one in the last 14 days. Sorted
     * by most-recent first so the trainer sees the warmest leads at the
     * top.
     */
    const rows = await booked_session.aggregate([
      {
        $match: {
          trainer_id: trainerObj,
          status: { $in: ["confirmed", "completed", "booked", "upcoming"] },
        },
      },
      {
        $group: {
          _id: "$trainee_id",
          last_session: { $max: "$booked_date" },
          total_sessions: { $sum: 1 },
        },
      },
      { $match: { last_session: { $lt: cutoff } } },
      { $sort: { last_session: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "user",
          localField: "_id",
          foreignField: "_id",
          as: "trainee",
        },
      },
      { $unwind: "$trainee" },
      {
        $project: {
          _id: 0,
          trainee_id: "$_id",
          last_session: 1,
          total_sessions: 1,
          fullname: "$trainee.fullname",
          profile_picture: "$trainee.profile_picture",
        },
      },
    ]);

    return ResponseBuilder.data(
      {
        candidates: rows.map((row) => ({
          trainee_id: String(row.trainee_id),
          fullname: row.fullname,
          profile_picture: row.profile_picture,
          last_session: row.last_session,
          days_since: Math.floor(
            (Date.now() - new Date(row.last_session).getTime()) /
              (24 * 60 * 60 * 1000)
          ),
          total_sessions: row.total_sessions,
        })),
      },
      "Inactive trainees"
    );
  }

  async sendNudge(args: {
    trainerId: string;
    traineeId: string;
    template?: NudgeTemplate;
    customMessage?: string;
  }): Promise<ResponseBuilder> {
    const { trainerId, traineeId } = args;
    if (
      !mongoose.isValidObjectId(trainerId) ||
      !mongoose.isValidObjectId(traineeId)
    ) {
      return ResponseBuilder.badRequest("Invalid ids");
    }

    /**
     * Rate limit to one nudge per (trainer, trainee) per day so trainers
     * can't accidentally spam the same trainee with the bring-back
     * template. The cooldown is per-pair, not per-trainer global.
     */
    const rateKey = `${trainerId}:${traineeId}`;
    const lastFiredAt = NUDGE_RATE.get(rateKey);
    if (lastFiredAt && Date.now() - lastFiredAt < NUDGE_COOLDOWN_MS) {
      return ResponseBuilder.badRequest(
        "You've already nudged this trainee in the last 24 hours."
      );
    }

    const [trainerDoc, traineeDoc] = await Promise.all([
      user.findById(trainerId).select("fullname").lean(),
      user.findById(traineeId).select("fullname").lean(),
    ]);
    if (!trainerDoc || !traineeDoc) {
      return ResponseBuilder.badRequest("User not found");
    }

    const lastSession = await booked_session
      .findOne({
        trainer_id: trainerId,
        trainee_id: traineeId,
        status: { $in: ["confirmed", "completed", "booked", "upcoming"] },
      })
      .sort({ booked_date: -1 })
      .select("booked_date")
      .lean();
    const daysSince = lastSession?.booked_date
      ? Math.max(
          1,
          Math.floor(
            (Date.now() - new Date(lastSession.booked_date).getTime()) /
              (24 * 60 * 60 * 1000)
          )
        )
      : 14;

    const body = (args.customMessage ?? "").trim()
      ? args.customMessage!.trim()
      : templateFor(
          args.template ?? "comeback",
          String(trainerDoc.fullname ?? "Coach"),
          String(traineeDoc.fullname ?? "there"),
          daysSince
        );

    if (body.length > 1500) {
      return ResponseBuilder.badRequest("Message is too long.");
    }

    const sent = await this.chat.sendMessage(
      String(trainerId),
      String(traineeId),
      body,
      "text"
    );
    if (sent.code >= 400) {
      return sent;
    }

    NUDGE_RATE.set(rateKey, Date.now());

    void this.push.sendPushNotification(
      String(traineeId),
      `${trainerDoc.fullname ?? "Your coach"} sent you a message`,
      body.slice(0, 140),
      { kind: "trainer_nudge", trainerId: String(trainerId) }
    );

    return ResponseBuilder.data(
      {
        sent: true,
        message: body,
        template: args.template ?? "comeback",
      },
      "Nudge sent"
    );
  }
}

export const traineeNudgeService = new TraineeNudgeService();
