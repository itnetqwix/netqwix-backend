/**
 * Explicit checkout lifecycle hooks (cancel / complete) for points and promo revert.
 */

export type CheckoutLifecycleEvent = "booking_cancelled" | "booking_completed";

type CheckoutHook = (ctx: { sessionId: string; traineeId?: string }) => Promise<void>;

const hooks: Partial<Record<CheckoutLifecycleEvent, CheckoutHook[]>> = {};

export function registerCheckoutHook(
  event: CheckoutLifecycleEvent,
  fn: CheckoutHook
): void {
  if (!hooks[event]) hooks[event] = [];
  hooks[event]!.push(fn);
}

export async function emitCheckoutLifecycle(
  event: CheckoutLifecycleEvent,
  ctx: { sessionId: string; traineeId?: string }
): Promise<void> {
  const list = hooks[event] ?? [];
  for (const fn of list) {
    try {
      await fn(ctx);
    } catch (err) {
      console.error(`[checkout] hook ${event} failed:`, err);
    }
  }
}

/** Wire points/referral hooks once at module load. */
export function bootstrapCheckoutHooks(): void {
  if ((global as any).__nqCheckoutHooksBootstrapped) return;
  (global as any).__nqCheckoutHooksBootstrapped = true;

  registerCheckoutHook("booking_cancelled", async ({ sessionId }) => {
    try {
      const booked_session = require("../../model/booked_sessions.schema").default;
      const { onBookingCancelled } = require("../points/bookingPointsHooks");
      const booking = await booked_session.findById(sessionId).lean();
      if (booking) {
        await onBookingCancelled({
          _id: booking._id,
          trainee_id: booking.trainee_id,
          trainer_id: booking.trainer_id,
          coupon_code: booking.coupon_code,
        });
      }
    } catch (err) {
      console.error("[checkout] booking_cancelled hook:", err);
    }
  });
}

bootstrapCheckoutHooks();
