import type { PromoSponsorType } from "../../config/promo";
import { PROMO_SPONSOR } from "../../config/promo";

export type PromoPayoutSplit = {
  discountedSubtotalCents: number;
  /** Subtotal used for commission + trainer net. */
  commissionBaseCents: number;
  platformFeePercentCents: number;
  trainerNetCents: number;
  /** Platform absorbs this amount from margin (platform-sponsored promos only). */
  platformPromoSubsidyCents: number;
  promoSponsorType: PromoSponsorType;
};

/**
 * Platform promo: trainee pays less; trainer net is based on full list price.
 * Trainer promo: discount reduces trainer payout (commission on discounted subtotal).
 */
export function computePromoPayoutSplit(params: {
  sessionSubtotalCents: number;
  promoDiscountCents: number;
  promoSponsorType?: PromoSponsorType | null;
  commissionRate: number;
  trainerPlatformFeeCents: number;
}): PromoPayoutSplit {
  const sessionSubtotalCents = Math.max(0, Math.round(params.sessionSubtotalCents || 0));
  const promoDiscountCents = Math.max(0, Math.round(params.promoDiscountCents || 0));
  const discountedSubtotalCents = Math.max(0, sessionSubtotalCents - promoDiscountCents);
  const sponsor =
    params.promoSponsorType === PROMO_SPONSOR.TRAINER
      ? PROMO_SPONSOR.TRAINER
      : promoDiscountCents > 0
        ? PROMO_SPONSOR.PLATFORM
        : PROMO_SPONSOR.PLATFORM;

  const commissionBaseCents =
    sponsor === PROMO_SPONSOR.PLATFORM && promoDiscountCents > 0
      ? sessionSubtotalCents
      : discountedSubtotalCents;

  const platformFeePercentCents = Math.round(commissionBaseCents * params.commissionRate);
  const trainerNetCents = Math.max(
    0,
    commissionBaseCents - platformFeePercentCents - params.trainerPlatformFeeCents
  );
  const platformPromoSubsidyCents =
    sponsor === PROMO_SPONSOR.PLATFORM && promoDiscountCents > 0 ? promoDiscountCents : 0;

  return {
    discountedSubtotalCents,
    commissionBaseCents,
    platformFeePercentCents,
    trainerNetCents,
    platformPromoSubsidyCents,
    promoSponsorType: sponsor,
  };
}
