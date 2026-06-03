import { Document, Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

export type ClipShareRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export interface IClipShareRequest extends Document {
  from_user_id: Schema.Types.ObjectId;
  to_user_id: Schema.Types.ObjectId;
  clip_ids: Schema.Types.ObjectId[];
  status: ClipShareRequestStatus;
  message?: string;
  responded_at?: Date;
  expires_at?: Date;
  /** Clip ids created in recipient locker after accept. */
  delivered_clip_ids?: Schema.Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

const clipShareRequestSchema = new Schema(
  {
    from_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    to_user_id: {
      type: Schema.Types.ObjectId,
      ref: Tables.user,
      required: true,
      index: true,
    },
    clip_ids: [{ type: Schema.Types.ObjectId, ref: Tables.clip, required: true }],
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "cancelled", "expired"],
      default: "pending",
      index: true,
    },
    message: { type: String, default: "" },
    responded_at: { type: Date, default: null },
    expires_at: { type: Date, default: null },
    delivered_clip_ids: [{ type: Schema.Types.ObjectId, ref: Tables.clip }],
  },
  { timestamps: true }
);

clipShareRequestSchema.index({ to_user_id: 1, status: 1, createdAt: -1 });
clipShareRequestSchema.index(
  { from_user_id: 1, to_user_id: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

const ClipShareRequest = Model<IClipShareRequest>(
  Tables.clip_share_request,
  clipShareRequestSchema
);
export default ClipShareRequest;
