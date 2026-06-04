import mongoose from "mongoose";
import ReferralAttribution from "../../model/referral_attribution.schema";
import booked_session from "../../model/booked_sessions.schema";
import { AccountType } from "../auth/authEnum";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import {
  REFERRAL_CONFIG,
  estimateFirstLessonCheckoutDiscount,
} from "../../config/referral";
import { PromoCodeService } from "../promo-code/promoCodeService";
import type { PromoSponsorType } from "../../config/promo";

export type BookingCheckoutType = "instant" | "scheduled";

export type CheckoutDiscountResult = {
  originalPrice: number;
  promoDiscount: number;
  referralDiscount: number;
  totalDiscount: number;
  finalPrice: number;
  appliedPromoCode: string | null;
  promoSponsorType?: PromoSponsorType | null;
  promoTrainerId?: string | null;
  promoError?: string;
  referralEligible: boolean;
  referralAttributionId?: string;
};

export async function findEligibleReferralAttribution(traineeId: string) {
  if (!REFERRAL_CONFIG.enabled || !REFERRAL_CONFIG.firstLessonDiscount.enabled) {
    return null;
  }
  const attr = await ReferralAttribution.findOne({
    referee_user_id: traineeId,
    referee_account_type: AccountType.TRAINEE,
    first_lesson_discount_used: { $ne: true },
  }).lean();
  if (!attr) return null;

  const completedAsTrainee = await booked_session.countDocuments({
    trainee_id: traineeId,
    status: BOOKED_SESSIONS_STATUS.completed,
  });
  if (completedAsTrainee > 0) return null;

  return attr;
}

export function computeReferralDiscountOnRemainder(
  remainderAfterPromo: number
): number {
  return estimateFirstLessonCheckoutDiscount(remainderAfterPromo);
}

/**
 * Promo + referral first-lesson discount (referral applies to price after promo).
 */
export async function computeBookingCheckoutDiscounts(params: {
  traineeId: string;
  originalPrice: number;
  bookingType: BookingCheckoutType;
  couponCode?: string | null;
  trainerId?: string | null;
}): Promise<CheckoutDiscountResult> {
  const originalPrice = Number(params.originalPrice);
  let promoDiscount = 0;
  let appliedPromoCode: string | null = null;
  let promoSponsorType: PromoSponsorType | null = null;
  let promoTrainerId: string | null = null;

  if (params.couponCode && String(params.couponCode).trim()) {
    const promoService = new PromoCodeService();
    const promoResult = await promoService.validatePromoCode(
      String(params.couponCode).trim(),
      params.traineeId,
      "Trainee",
      params.bookingType,
      originalPrice,
      undefined,
      params.trainerId ?? undefined
    );
    if (!promoResult.valid) {
      return {
        originalPrice,
        promoDiscount: 0,
        referralDiscount: 0,
        totalDiscount: 0,
        finalPrice: originalPrice,
        appliedPromoCode: null,
        promoError: promoResult.reason || "Invalid or expired promo code.",
        referralEligible: false,
      };
    }
    promoDiscount = promoResult.discount_amount ?? 0;
    appliedPromoCode = String(params.couponCode).trim().toUpperCase();
    promoSponsorType = promoResult.sponsor_type ?? null;
    promoTrainerId = promoResult.trainer_id ?? null;
  }

  const afterPromo = Number(Math.max(originalPrice - promoDiscount, 0).toFixed(2));
  const attr = await findEligibleReferralAttribution(params.traineeId);
  /** Referral checkout $ discount disabled — use points program instead. */
  const referralDiscount = 0;
  const totalDiscount = Number((promoDiscount + referralDiscount).toFixed(2));
  const finalPrice = Number(Math.max(originalPrice - totalDiscount, 0).toFixed(2));

  return {
    originalPrice,
    promoDiscount,
    referralDiscount,
    totalDiscount,
    finalPrice,
    appliedPromoCode,
    promoSponsorType,
    promoTrainerId,
    referralEligible: !!attr && referralDiscount > 0,
    referralAttributionId: attr?._id ? String(attr._id) : undefined,
  };
}

export async function markReferralFirstLessonDiscountUsed(
  attributionId: string | undefined,
  amount: number,
  bookingId: string
) {
  if (!attributionId || amount <= 0) return;
  await ReferralAttribution.findByIdAndUpdate(attributionId, {
    $set: {
      first_lesson_discount_used: true,
      first_lesson_discount_amount: amount,
      first_lesson_discount_booking_id: new mongoose.Types.ObjectId(bookingId),
    },
  });
}
