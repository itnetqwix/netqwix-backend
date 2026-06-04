/** Who absorbs the promo discount at payout time. */
export type PromoSponsorType = "platform" | "trainer";

export const PROMO_SPONSOR = {
  PLATFORM: "platform" as PromoSponsorType,
  TRAINER: "trainer" as PromoSponsorType,
};
