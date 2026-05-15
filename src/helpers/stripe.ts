import { Utils } from "../Utils/Utils";
import { CONSTANCE } from "../config/constance";
import { ResponseBuilder } from "./responseBuilder";
import * as l10n from "jm-ez-l10n";
import { PromoCodeService } from "../modules/promo-code/promoCodeService";
import { WALLET_CONFIG } from "../config/wallet";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class StripeHelper {
  private promoService = new PromoCodeService();

  public createPaymentIntent = async (body: any, currency = "usd"): Promise<ResponseBuilder> => {
    try {
      const { amount, destination, commission, customer, couponCode } = body;
      const userId = body._userId;
      const userType = body._userType || "Trainee";

      if (typeof amount !== "number") {
        return ResponseBuilder.badRequest("Invalid amount.");
      }
      if (!CONSTANCE.supportedCurrencies.includes(currency.toLowerCase())) {
        return ResponseBuilder.badRequest("Invalid currency.");
      }

      let discountAmount = 0;
      let appliedPromoCode: string | null = null;

      if (couponCode) {
        const promoResult = await this.promoService.validatePromoCode(
          couponCode,
          userId,
          userType,
          body._bookingType,
          amount
        );

        if (promoResult.valid) {
          discountAmount = promoResult.discount_amount!;
          appliedPromoCode = couponCode;
        } else {
          return ResponseBuilder.badRequest(promoResult.reason || "Invalid or expired promo code.", 400);
        }
      }

      const finalAmount = amount - discountAmount;

      const stripe_config: any = {
        amount: Utils.roundedAmount(finalAmount * 100),
        currency: currency.toLowerCase(),
        description: "netquix - trainer fees",
        shipping: {
          name: "Test user",
          address: {
            line1: "510 Townsend St",
            postal_code: "98140",
            city: "San Francisco",
            state: "CA",
            country: "US",
          },
        },
        automatic_payment_methods: { enabled: true },
      };

      if (customer) {
        stripe_config.customer = customer;
      }

      const useEscrowHold = WALLET_CONFIG.escrowEnabled && body._bookingType !== "wallet_topup";
      if (destination && !useEscrowHold) {
        stripe_config.application_fee_amount = Math.round(finalAmount * Number(commission));
        stripe_config.transfer_data = { destination };
      } else if (useEscrowHold && body.sessionId) {
        stripe_config.metadata = {
          ...(stripe_config.metadata || {}),
          kind: body._bookingType || "session_booking",
          sessionId: body.sessionId,
          trainee_id: body._userId,
          trainer_id: body.trainer_id,
        };
      }

      if (stripe_config.amount <= 0) {
        return ResponseBuilder.data(
          { skip: true, appliedPromoCode, discountAmount },
          "SKIP_TRANSACTION_INTENT"
        );
      }
      const paymentIntent = await stripe.paymentIntents.create(stripe_config);

      return ResponseBuilder.data(
        { ...paymentIntent, appliedPromoCode, discountAmount },
        l10n.t("TRANSACTION_INTENT_CREATED")
      );
    } catch (err) {
      console.error("Error in payment intent creation:", err);
      if (err["statusCode"]) {
        return ResponseBuilder.badRequest(err.raw.message, 400);
      } else {
        return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
      }
    }
  };
}
