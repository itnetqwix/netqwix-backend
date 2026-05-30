import { Utils } from "../Utils/Utils";
import { CONSTANCE } from "../config/constance";
import { ResponseBuilder } from "./responseBuilder";
import * as l10n from "jm-ez-l10n";
import { PromoCodeService } from "../modules/promo-code/promoCodeService";
import { WALLET_CONFIG } from "../config/wallet";
import { PRICING_QUOTE_ENABLED, resolveRegionFromCountry } from "../../config/pricing";
import {
  getActivePricingConfig,
  buildQuote,
  getCachedQuote,
  quoteToEscrowMetadata,
} from "../modules/payments/pricingService";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class StripeHelper {
  private promoService = new PromoCodeService();

  public createPaymentIntent = async (body: any, currency = "usd"): Promise<ResponseBuilder> => {
    try {
      const {
        amount,
        destination,
        commission,
        customer,
        couponCode,
        quoteId,
        billingAddress,
        paymentMethodHint,
        trainer_id,
      } = body;
      const userId = body._userId;
      const userType = body._userType || "Trainee";
      const bookingType = body._bookingType || "session_booking";

      if (typeof amount !== "number" && !quoteId) {
        return ResponseBuilder.badRequest("Invalid amount.");
      }
      if (!CONSTANCE.supportedCurrencies.includes(currency.toLowerCase())) {
        return ResponseBuilder.badRequest("Invalid currency.");
      }

      let discountAmount = 0;
      let appliedPromoCode: string | null = null;
      let sessionSubtotal = amount;

      if (couponCode && !quoteId) {
        const promoResult = await this.promoService.validatePromoCode(
          couponCode,
          userId,
          userType,
          bookingType,
          amount
        );

        if (promoResult.valid) {
          discountAmount = promoResult.discount_amount!;
          appliedPromoCode = couponCode;
        } else {
          return ResponseBuilder.badRequest(promoResult.reason || "Invalid or expired promo code.", 400);
        }
      }

      let quoteMeta: Record<string, string> = {};
      let finalAmountMinor: number;
      let quoteResult: Awaited<ReturnType<typeof buildQuote>> | null = null;

      if (PRICING_QUOTE_ENABLED && quoteId) {
        const cached = getCachedQuote(quoteId);
        if (!cached) {
          return ResponseBuilder.badRequest("Quote expired or not found. Please refresh checkout.");
        }
        quoteResult = cached;
        finalAmountMinor = cached.chargeTotalCents;
        sessionSubtotal = cached.sessionSubtotalCents / 100;
        discountAmount = cached.promoDiscountCents / 100;
        quoteMeta = quoteToEscrowMetadata(cached, {
          kind: bookingType,
          sessionId: body.sessionId || "",
          trainee_id: userId || "",
          trainer_id: trainer_id || body.trainer_id || "",
        });
      } else if (PRICING_QUOTE_ENABLED && bookingType !== "wallet_topup") {
        const region = resolveRegionFromCountry(billingAddress?.country || body.region);
        const promoDiscountCents = Math.round(discountAmount * 100);
        quoteResult = await buildQuote({
          region,
          productType: bookingType === "instant" ? "instant_lesson" : bookingType === "session_extension" ? "session_extension" : "session_booking",
          sessionSubtotalCents: Math.round((amount - discountAmount) * 100) + promoDiscountCents,
          trainerId: trainer_id || body.trainer_id,
          paymentMethodHint,
          billingAddress,
          promoDiscountCents,
          userId,
        });
        finalAmountMinor = quoteResult.chargeTotalCents;
        discountAmount = quoteResult.promoDiscountCents / 100;
        quoteMeta = quoteToEscrowMetadata(quoteResult, {
          kind: bookingType,
          sessionId: body.sessionId || "",
          trainee_id: userId || "",
          trainer_id: trainer_id || body.trainer_id || "",
          quote_id: quoteResult.quoteId,
        });
      } else {
        const finalAmount = amount - discountAmount;
        finalAmountMinor = Utils.roundedAmount(finalAmount * 100);
      }

      const stripeCurrency = quoteResult?.currency?.toLowerCase() || currency.toLowerCase();

      const stripe_config: any = {
        amount: finalAmountMinor,
        currency: stripeCurrency,
        description: "NetQwix session payment",
        automatic_payment_methods: { enabled: true },
        metadata: { ...quoteMeta },
      };

      if (customer) {
        stripe_config.customer = customer;
      }

      if (billingAddress?.line1) {
        stripe_config.shipping = {
          name: body.payerName || "NetQwix customer",
          address: {
            line1: billingAddress.line1,
            city: billingAddress.city,
            state: billingAddress.state,
            postal_code: billingAddress.postal_code,
            country: billingAddress.country || "US",
          },
        };
      }

      const activeConfig = await getActivePricingConfig();
      const regionKey = quoteResult?.region || resolveRegionFromCountry(billingAddress?.country);
      const stripeTaxEnabled =
        process.env.STRIPE_TAX_ENABLED === "true" ||
        activeConfig.regions[regionKey]?.stripeTaxEnabled === true;

      if (stripeTaxEnabled && bookingType !== "wallet_topup") {
        stripe_config.automatic_tax = { enabled: true };
      }

      const useEscrowHold = WALLET_CONFIG.escrowEnabled && bookingType !== "wallet_topup";
      if (destination && !useEscrowHold) {
        stripe_config.application_fee_amount = Math.round(
          (sessionSubtotal - discountAmount) * Number(commission)
        );
        stripe_config.transfer_data = { destination };
      } else if (useEscrowHold) {
        stripe_config.metadata = {
          ...(stripe_config.metadata || {}),
          kind: bookingType,
          sessionId: body.sessionId || stripe_config.metadata?.sessionId || "",
          trainee_id: userId || stripe_config.metadata?.trainee_id || "",
          trainer_id: trainer_id || body.trainer_id || stripe_config.metadata?.trainer_id || "",
        };
      }

      if (stripe_config.amount <= 0) {
        return ResponseBuilder.data(
          { skip: true, appliedPromoCode, discountAmount, quote: quoteResult },
          "SKIP_TRANSACTION_INTENT"
        );
      }
      const paymentIntent = await stripe.paymentIntents.create(stripe_config);

      return ResponseBuilder.data(
        {
          ...paymentIntent,
          appliedPromoCode,
          discountAmount,
          quote: quoteResult,
        },
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
