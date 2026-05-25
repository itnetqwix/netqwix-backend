import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

/**
 * Per-trainee notes that a trainer pins to a trainee. Surfaced as a
 * "post-it" card above the chat so the trainer always sees important
 * context — injuries, goals, prior session takeaways — without having to
 * scroll back through history.
 *
 * Visibility is one-way: only the authoring trainer can read or write
 * these notes; the trainee never sees them.
 */
const trainerTraineeNoteSchema = new Schema(
  {
    trainer_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    trainee_id: {
      type: Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    text: { type: String, required: true, maxlength: 1500 },
    /**
     * Up to 5 short tags surfaced as chips next to the note. Useful for
     * "injury", "goal", "preference", etc.
     */
    tags: { type: [String], default: [], validate: (v: string[]) => v.length <= 5 },
    updated_by: { type: Types.ObjectId, ref: Tables.user },
  },
  { timestamps: true }
);

trainerTraineeNoteSchema.index(
  { trainer_id: 1, trainee_id: 1 },
  { unique: true }
);

export default Model(Tables.trainer_trainee_notes, trainerTraineeNoteSchema);
