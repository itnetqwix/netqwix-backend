import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const stripeWebhookEventSchema = new Schema(
  {
    stripe_event_id: { type: String, required: true, unique: true },
    type: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed },
    processed: { type: Boolean, default: false },
    processed_at: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);

export default Model(Tables.stripe_webhook_events, stripeWebhookEventSchema);
