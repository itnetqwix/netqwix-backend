import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { PRICING_QUOTE_ENABLED } from "../../config/pricing";
import { pricingService } from "./pricingService";

export class PricingController {
  quote = async (req: Request, res: Response) => {
    try {
      if (!PRICING_QUOTE_ENABLED) {
        return res.status(503).json({
          status: CONSTANCE.FAIL,
          msg: "Pricing quote API is disabled",
        });
      }

      const {
        region,
        productType,
        sessionSubtotalCents,
        trainerId,
        paymentMethodHint,
        billingAddress,
        promoDiscountCents,
      } = req.body;

      const subtotal = Number(sessionSubtotalCents);
      if (!Number.isFinite(subtotal) || subtotal < 0) {
        return res.status(400).json({ status: CONSTANCE.FAIL, msg: "Invalid sessionSubtotalCents" });
      }

      const quote = await pricingService.quote({
        region,
        productType: productType || "session_booking",
        sessionSubtotalCents: subtotal,
        trainerId,
        paymentMethodHint,
        billingAddress,
        promoDiscountCents: Number(promoDiscountCents || 0),
        userId: req["authUser"]?._id,
      });

      return res.status(200).json({ status: CONSTANCE.SUCCESS, data: quote });
    } catch (err: any) {
      return res.status(500).json({ status: CONSTANCE.FAIL, msg: err?.message || "Quote failed" });
    }
  };

  getQuoteById = async (req: Request, res: Response) => {
    const quote = pricingService.getQuote(req.params.quoteId);
    if (!quote) {
      return res.status(404).json({ status: CONSTANCE.FAIL, msg: "Quote not found or expired" });
    }
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: quote });
  };
}

export const pricingController = new PricingController();
