/**
 * Optional promo soft-reserve during booking (disabled by default until load-tested).
 */

export const PROMO_RESERVE_AT_BOOKING =
  process.env.PROMO_RESERVE_AT_BOOKING === "true";

export async function reservePromoForBooking(_params: {
  promoCode: string;
  traineeId: string;
  bookingId: string;
}): Promise<{ reserved: boolean }> {
  if (!PROMO_RESERVE_AT_BOOKING) {
    return { reserved: false };
  }
  // Future: atomic increment in promo usage with session id
  return { reserved: false };
}
