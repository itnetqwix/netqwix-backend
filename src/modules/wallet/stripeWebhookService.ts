import stripe_webhook_events from "../../model/stripe_webhook_events.schema";
import { topUpService } from "./topUpService";
import { escrowService } from "./escrowService";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class StripeWebhookService {
  async handleEvent(rawBody: Buffer, signature: string) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET not configured");
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

    const existing = await stripe_webhook_events.findOne({
      stripe_event_id: event.id,
    });
    if (existing?.processed) {
      return { received: true, duplicate: true };
    }

    await stripe_webhook_events.findOneAndUpdate(
      { stripe_event_id: event.id },
      {
        stripe_event_id: event.id,
        type: event.type,
        payload: event,
        processed: false,
      },
      { upsert: true }
    );

    try {
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        const kind = pi.metadata?.kind;
        if (kind === "wallet_topup") {
          await topUpService.completeTopUpFromWebhook(pi.id, event.id);
        } else if (
          kind === "session_extension" ||
          kind === "session_booking" ||
          pi.metadata?.sessionId
        ) {
          const sessionId = pi.metadata?.sessionId;
          const traineeId = pi.metadata?.trainee_id;
          const trainerId = pi.metadata?.trainer_id;
          if (sessionId && traineeId && trainerId) {
            await escrowService.createCardEscrowRecord({
              sessionId,
              traineeId,
              trainerId,
              grossMinor: pi.amount,
              platformFeeMinor: 0,
              fundingSource: "card",
              stripePaymentIntentId: pi.id,
              kind: pi.metadata?.kind === "session_extension" ? "extension" : "booking",
              idempotencyKey: `webhook:escrow:${pi.id}`,
            });
          }
        }
      }

      await stripe_webhook_events.updateOne(
        { stripe_event_id: event.id },
        { processed: true, processed_at: new Date() }
      );
    } catch (err: any) {
      await stripe_webhook_events.updateOne(
        { stripe_event_id: event.id },
        { error: err?.message || String(err) }
      );
      throw err;
    }

    return { received: true };
  }
}

export const stripeWebhookService = new StripeWebhookService();
