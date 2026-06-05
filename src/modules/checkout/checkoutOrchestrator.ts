/**
 * Checkout orchestration — wallet pay, escrow, promo, trainer legacy wallet_amount.
 * Called from traineeService / sessionExtensionService; routes unchanged.
 */

import mongoose from "mongoose";
import user from "../../model/user.schema";
import { WALLET_CONFIG } from "../../config/wallet";
import {
  applyPromoAfterBookingSave,
  computeScheduledBookingDiscounts,
  markReferralDiscountUsed,
  type BookingCheckoutDiscounts,
} from "./checkoutPromoHooks";
import { rollbackWalletBookingPayment } from "./checkoutRollback";
import { reservePromoForBooking } from "./promoReservation";

export type ScheduledWalletPayParams = {
  traineeId: string;
  sessionId: string;
  trainerId: string;
  amountDollars: number;
  pinSessionToken?: string;
  quoteId?: string;
  billingAddress?: unknown;
};

export class CheckoutOrchestrator {
  async computeScheduledDiscounts(params: {
    traineeId: string;
    originalPrice: number;
    couponCode?: string;
    trainerId?: string;
  }): Promise<BookingCheckoutDiscounts> {
    return computeScheduledBookingDiscounts(params);
  }

  async payScheduledBookingFromWallet(params: ScheduledWalletPayParams): Promise<void> {
    const { walletPaymentService } = require("../wallet/walletPaymentService");
    await walletPaymentService.payFromWallet({
      traineeId: params.traineeId,
      sessionId: params.sessionId,
      trainerId: params.trainerId,
      amountDollars: params.amountDollars,
      pinSessionToken: params.pinSessionToken,
      kind: "booking",
      idempotencyKey: `book:wallet:${params.sessionId}`,
      quoteId: params.quoteId,
      billingAddress: params.billingAddress,
    });
  }

  async rollbackScheduledWalletBooking(params: {
    sessionId: string;
    traineeId: string;
  }): Promise<void> {
    await rollbackWalletBookingPayment({
      sessionId: params.sessionId,
      traineeId: params.traineeId,
      idempotencyKey: `book:wallet:${params.sessionId}`,
      reason: "booking_save_failed",
    });
  }

  async afterScheduledBookingSaved(params: {
    booking: { _id: unknown; trainee_id?: unknown; trainer_id?: unknown };
    payload: {
      payment_method?: string;
      payment_intent_id?: string;
      trainer_id: string;
    };
    appliedPromoCode?: string;
    promoDiscountAmount: number;
    referralAttributionId?: string;
    referralDiscountAmount: number;
    traineeId: string;
    finalPrice: number;
  }): Promise<void> {
    const bookingId = String(params.booking._id);

    if (params.appliedPromoCode && params.promoDiscountAmount > 0) {
      void applyPromoAfterBookingSave({
        promoCode: params.appliedPromoCode,
        traineeId: params.traineeId,
        sessionId: bookingId,
        discountAmount: params.promoDiscountAmount,
      });
    }

    if (params.referralAttributionId && params.referralDiscountAmount > 0) {
      void markReferralDiscountUsed({
        attributionId: params.referralAttributionId,
        amount: params.referralDiscountAmount,
        sessionId: bookingId,
      });
    }

    await this.incrementTrainerLegacyWallet(params.payload.trainer_id, params.finalPrice);

    await this.createEscrowIfNeeded({
      sessionId: bookingId,
      traineeId: String(params.booking.trainee_id ?? params.traineeId),
      trainerId: String(params.payload.trainer_id),
      finalPrice: params.finalPrice,
      paymentMethod: params.payload.payment_method,
      paymentIntentId: params.payload.payment_intent_id,
    });
  }

  async reservePromoIfEnabled(
    promoCode: string,
    traineeId: string,
    bookingId: string
  ): Promise<void> {
    await reservePromoForBooking({ promoCode, traineeId, bookingId });
  }

  private async incrementTrainerLegacyWallet(trainerId: string, amount: number) {
    if (!amount) return;
    await user.updateOne({ _id: trainerId }, { $inc: { wallet_amount: amount } });
  }

  /**
   * Card escrow: webhook is primary writer when payment_intent_id is set.
   * Non-PI card paths may create escrow here (legacy).
   */
  async createEscrowIfNeeded(params: {
    sessionId: string;
    traineeId: string;
    trainerId: string;
    finalPrice: number;
    paymentMethod?: string;
    paymentIntentId?: string;
  }): Promise<void> {
    try {
      if (!WALLET_CONFIG.escrowEnabled || params.finalPrice <= 0) return;

      const paidByWallet = params.paymentMethod === "wallet";
      const paidByCardPi = !!params.paymentIntentId;
      if (paidByWallet || paidByCardPi) return;

      const { escrowService } = require("../wallet/escrowService");
      await escrowService.createCardEscrowRecord({
        sessionId: params.sessionId,
        traineeId: params.traineeId,
        trainerId: params.trainerId,
        grossMinor: Math.round(params.finalPrice * 100),
        platformFeeMinor: 0,
        fundingSource: "card",
        stripePaymentIntentId: params.paymentIntentId,
        kind: "booking",
        idempotencyKey: `book:escrow:${params.sessionId}`,
      });
    } catch (walletErr) {
      console.error("[checkout] Escrow record error:", walletErr);
    }
  }
}

export const checkoutOrchestrator = new CheckoutOrchestrator();
