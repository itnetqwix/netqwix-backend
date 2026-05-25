import mongoose from "mongoose";
import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import booked_session from "../../model/booked_sessions.schema";
import { ChatService } from "../chat/chatService";

/**
 * Builds the trainer's post-session recap. The recap is sent as a
 * single chat message in the trainer↔trainee thread so the trainee can
 * scroll back to it the next day. The message is formatted with
 * markdown-ish bullet points (still readable as plain text) and is
 * tagged as type="text" so existing message rendering paths work
 * without any client change.
 */
export class SessionRecapService {
  public log = log.getLogger();
  private chat = new ChatService();

  async sendRecap(args: {
    trainerId: string;
    sessionId?: string;
    traineeId?: string;
    summary?: string;
    drills?: string;
    homework?: string;
  }): Promise<ResponseBuilder> {
    const { trainerId } = args;
    if (!mongoose.isValidObjectId(trainerId)) {
      return ResponseBuilder.badRequest("Invalid trainer id");
    }

    let traineeId = args.traineeId;
    if (!traineeId && args.sessionId) {
      if (!mongoose.isValidObjectId(args.sessionId)) {
        return ResponseBuilder.badRequest("Invalid session id");
      }
      const session = await booked_session
        .findById(args.sessionId)
        .select("trainer_id trainee_id")
        .lean();
      if (!session) {
        return ResponseBuilder.badRequest("Session not found");
      }
      if (String(session.trainer_id) !== String(trainerId)) {
        return ResponseBuilder.badRequest("Not your session", 403);
      }
      traineeId = String(session.trainee_id);
    }

    if (!traineeId || !mongoose.isValidObjectId(traineeId)) {
      return ResponseBuilder.badRequest("Invalid trainee id");
    }

    const summary = (args.summary ?? "").trim();
    const drills = (args.drills ?? "").trim();
    const homework = (args.homework ?? "").trim();

    if (!summary && !drills && !homework) {
      return ResponseBuilder.badRequest("Recap is empty.");
    }

    const lines: string[] = ["📝 Session recap"];
    if (summary) {
      lines.push("");
      lines.push(summary);
    }
    if (drills) {
      lines.push("");
      lines.push("Drills we covered:");
      lines.push(drills);
    }
    if (homework) {
      lines.push("");
      lines.push("Homework:");
      lines.push(homework);
    }

    const body = lines.join("\n").slice(0, 1500);

    const sent = await this.chat.sendMessage(
      String(trainerId),
      String(traineeId),
      body,
      "text"
    );
    if (sent.code >= 400) {
      return sent;
    }

    return ResponseBuilder.data({ sent: true, message: body }, "Recap sent");
  }
}

export const sessionRecapService = new SessionRecapService();
