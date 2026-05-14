import { Utils } from "../Utils/Utils";
import { CONSTANCE } from "../config/constance";
import { ResponseBuilder } from "./responseBuilder";
import * as l10n from "jm-ez-l10n";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class StripeHelper {
  public createPaymentIntent = async (body: any, currency = "usd"): Promise<ResponseBuilder> => {
    try {
      const { amount, destination, commission, customer, couponCode } = body;

      if (typeof amount !== "number") {
        return ResponseBuilder.badRequest("Invalid amount.");
      }
      if (!CONSTANCE.supportedCurrencies.includes(currency.toLowerCase())) {
        return ResponseBuilder.badRequest("Invalid currency.");
      }

      // Step 1: Fetch the PromotionCode if a couponCode is provided
      let promotionCode: string | null = null;
      let discountAmount = 0;
      
      if (couponCode) {
        const promotionCodes = await stripe.promotionCodes.list({
          code: couponCode, // Searching for the provided coupon code
        });

        if (promotionCodes.data.length > 0) {
          const coupon = promotionCodes.data[0].coupon;  // Access the coupon associated with the promotion code
          promotionCode = promotionCodes.data[0].id;  // Get the promotion code ID
          
          // Step 2: Calculate the discount based on the percent_off in the coupon
          if (coupon.percent_off) {
            discountAmount = (amount * coupon.percent_off) / 100;  // Calculate the discount
          }
        } else {
          return ResponseBuilder.badRequest("Invalid or expired coupon code.", 400);
       
        }
      }

      // Step 3: Apply the discount to the amount
      const finalAmount = amount - discountAmount;  // Subtract the discount from the original amount

      // Step 4: Create the payment intent parameters
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

      if (destination) {
        stripe_config.application_fee_amount = Math.round(finalAmount * Number(commission));
        stripe_config.transfer_data = { destination };
      }

      console.log("=====> stripe_config", stripe_config);
      
      if(stripe_config.amount <= 0){
        return ResponseBuilder.data({skip:true}, "SKIP_TRANSACTION_INTENT");
      }
      const paymentIntent = await stripe.paymentIntents.create(stripe_config);
      // Step 5: Create the payment intent
    
      // Return success response with the payment intent details
      return ResponseBuilder.data(paymentIntent, l10n.t("TRANSACTION_INTENT_CREATED"));
    } catch (err) {
      // Handle errors
      console.error("Error in payment intent creation:", err);
      if (err["statusCode"]) {
        return ResponseBuilder.badRequest(err.raw.message, 400);
      } else {
        return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
      }
    }
  };
}
