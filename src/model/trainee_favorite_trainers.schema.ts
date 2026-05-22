import { Schema, model as Model, Types } from "mongoose";
import { Tables } from "../config/tables";

const traineeFavoriteTrainerSchema = new Schema(
  {
    trainee_id: { type: Types.ObjectId, ref: Tables.user, required: true, index: true },
    trainer_id: { type: Types.ObjectId, ref: Tables.user, required: true, index: true },
  },
  { timestamps: true }
);

traineeFavoriteTrainerSchema.index({ trainee_id: 1, trainer_id: 1 }, { unique: true });

export default Model(Tables.trainee_favorite_trainers, traineeFavoriteTrainerSchema);
