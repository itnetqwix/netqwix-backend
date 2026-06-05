/**
 * Promo / referral application after successful booking save.
 */

import { PromoCodeService } from "../promo-code/promoCodeService";

export type BookingCheckoutDiscounts = {
  promoDiscount: number;
  referralDiscount: number;
  finalPrice: number;
  appliedPromoCode?: string;
  promoSponsorType?: string;
  promoError?: string;
  totalDiscount: number;
  referralAttributionId?: string;
};

export async function computeScheduledBookingDiscounts(params: {
  traineeId: string;
  originalPrice: number;
  couponCode?: string;
  trainerId?: string;
}): Promise<BookingCheckoutDiscounts> {
  const { computeBookingCheckoutDiscounts } = require("../referral/referralCheckoutDiscount");
  return computeBookingCheckoutDiscounts({
    traineeId: params.traineeId,
    originalPrice: params.originalPrice,
    bookingType: "scheduled",
    couponCode: params.couponCode,
    trainerId: params.trainerId,
  });
}

export async function applyPromoAfterBookingSave(params: {
  promoCode: string;
  traineeId: string;
  sessionId: string;
  discountAmount: number;
}): Promise<void> {
  const promoService = new PromoCodeService();
  await promoService.applyPromoCode(
    params.promoCode,
    params.traineeId,
    params.sessionId,
    params.discountAmount
  );
}

export async function markReferralDiscountUsed(params: {
  attributionId: string;
  amount: number;
  sessionId: string;
}): Promise<void> {
  const { markReferralFirstLessonDiscountUsed } = require("../referral/referralCheckoutDiscount");
  await markReferralFirstLessonDiscountUsed(
    params.attributionId,
    params.amount,
    params.sessionId
  );
}
