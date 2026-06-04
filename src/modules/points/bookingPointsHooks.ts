import booked_session from "../../model/booked_sessions.schema";
import ReferralAttribution from "../../model/referral_attribution.schema";
import ReferralReward from "../../model/referral_reward.schema";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { PromoCodeService } from "../promo-code/promoCodeService";
import { pointsService } from "./pointsService";

const promoService = new PromoCodeService();

/**
 * When a booking is cancelled/refunded: revert promo usage and claw back session activity points.
 */
export async function onBookingCancelled(booking: {
  _id?: string;
  trainee_id?: string;
  trainer_id?: string;
  coupon_code?: string | null;
  wasCompleted?: boolean;
}) {
  const bookingId = String(booking._id ?? "");
  if (!bookingId) return;

  const traineeId = booking.trainee_id ? String(booking.trainee_id) : "";
  const trainerId = booking.trainer_id ? String(booking.trainer_id) : "";
  const code = booking.coupon_code?.trim();

  if (code && traineeId) {
    try {
      await promoService.revertPromoUsage(code, traineeId, bookingId);
    } catch (e) {
      console.warn("[onBookingCancelled] promo revert failed", bookingId, e);
    }
  }

  if (trainerId) {
    await pointsService.clawbackEarn({
      userId: trainerId,
      earnIdempotencyKey: `points:lesson_trainer:${bookingId}`,
      actionKey: "lesson_completed_trainer",
      referenceType: "session",
      referenceId: bookingId,
    });
  }
  if (traineeId) {
    await pointsService.clawbackEarn({
      userId: traineeId,
      earnIdempotencyKey: `points:lesson_trainee:${bookingId}`,
      actionKey: "lesson_completed_trainee",
      referenceType: "session",
      referenceId: bookingId,
    });
    await pointsService.clawbackEarn({
      userId: traineeId,
      earnIdempotencyKey: `points:booking_trainee:${bookingId}`,
      actionKey: "booking_completed_trainee",
      referenceType: "session",
      referenceId: bookingId,
    });
    await pointsService.clawbackEarn({
      userId: traineeId,
      earnIdempotencyKey: `points:review:${bookingId}`,
      actionKey: "review_submitted",
      referenceType: "review",
      referenceId: bookingId,
    });
  }

  if (booking.wasCompleted) {
    await clawbackReferralFirstBookingForSession(bookingId);
  }
}

async function clawbackReferralFirstBookingForSession(bookingId: string) {
  const reward = await ReferralReward.findOne({
    trigger: "first_booking",
    booking_id: bookingId,
    status: "credited",
  }).lean();
  if (!reward?.attribution_id) return;

  const attrId = String(reward.attribution_id);
  await pointsService.clawbackEarn({
    userId: String(reward.beneficiary_user_id),
    earnIdempotencyKey: `points:referral:first_booking:referrer:${attrId}`,
    actionKey: "referral_first_booking_referrer",
    referenceType: "referral",
    referenceId: attrId,
    metadata: { clawbackBookingId: bookingId },
  });

  await ReferralAttribution.findByIdAndUpdate(attrId, {
    $set: { first_booking_reward_settled: false },
  });
}

/** Load session and run cancel hooks (promo + points). */
export async function onBookingCancelledById(sessionId: string) {
  const booking = await booked_session.findById(sessionId).lean();
  if (!booking) return;
  const wasCompleted = booking.status === BOOKED_SESSIONS_STATUS.completed;
  await onBookingCancelled({
    _id: String(booking._id),
    trainee_id: booking.trainee_id,
    trainer_id: booking.trainer_id,
    coupon_code: (booking as any).coupon_code,
    wasCompleted,
  });
}
