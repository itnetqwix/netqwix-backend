import mongoose from "mongoose";
import { log } from "../../../logger";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import trainer_trainee_note from "../../model/trainer_trainee_note.schema";

/**
 * CRUD-lite for the trainer's per-trainee notes. Notes are scoped to the
 * authoring trainer — we never look up by trainee alone, so a trainee
 * can't read what other trainers have written about them.
 */
export class TrainerNotesService {
  public log = log.getLogger();

  async getNote(trainerId: string, traineeId: string): Promise<ResponseBuilder> {
    if (
      !mongoose.isValidObjectId(trainerId) ||
      !mongoose.isValidObjectId(traineeId)
    ) {
      return ResponseBuilder.badRequest("Invalid id");
    }
    const note = await trainer_trainee_note
      .findOne({ trainer_id: trainerId, trainee_id: traineeId })
      .lean();
    return ResponseBuilder.data({ note: note ?? null }, "Note");
  }

  async upsertNote(
    trainerId: string,
    traineeId: string,
    payload: { text: string; tags?: string[] }
  ): Promise<ResponseBuilder> {
    if (
      !mongoose.isValidObjectId(trainerId) ||
      !mongoose.isValidObjectId(traineeId)
    ) {
      return ResponseBuilder.badRequest("Invalid id");
    }
    const text = String(payload?.text ?? "").trim();
    if (!text) {
      return ResponseBuilder.badRequest("Note text is required.");
    }
    if (text.length > 1500) {
      return ResponseBuilder.badRequest("Notes are capped at 1500 characters.");
    }
    const tags = Array.isArray(payload?.tags)
      ? payload.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    const updated = await trainer_trainee_note
      .findOneAndUpdate(
        { trainer_id: trainerId, trainee_id: traineeId },
        {
          $set: {
            text,
            tags,
            updated_by: trainerId,
          },
          $setOnInsert: {
            trainer_id: trainerId,
            trainee_id: traineeId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
      .lean();

    return ResponseBuilder.data({ note: updated }, "Note saved");
  }

  async deleteNote(
    trainerId: string,
    traineeId: string
  ): Promise<ResponseBuilder> {
    if (
      !mongoose.isValidObjectId(trainerId) ||
      !mongoose.isValidObjectId(traineeId)
    ) {
      return ResponseBuilder.badRequest("Invalid id");
    }
    await trainer_trainee_note.deleteOne({
      trainer_id: trainerId,
      trainee_id: traineeId,
    });
    return ResponseBuilder.data({ deleted: true }, "Note removed");
  }
}

export const trainerNotesService = new TrainerNotesService();
