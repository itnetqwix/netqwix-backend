import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { DEFAULT_PRICING_CONFIG } from "../../config/pricing";
import { assertAdminPermission, assertAdminUser } from "./adminPermission";
import { pricingService } from "../payments/pricingService";

export class PricingAdminController {
  getConfig = async (req: Request, res: Response) => {
    const denied = assertAdminUser(req["authUser"]);
    if (denied) return res.status(403).json({ status: CONSTANCE.FAIL, msg: denied });
    const config = await pricingService.getActiveConfig();
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: config });
  };

  updateConfig = async (req: Request, res: Response) => {
    const denied = assertAdminPermission(req["authUser"], "can_manage_pricing");
    if (denied) return res.status(403).json({ status: CONSTANCE.FAIL, msg: denied });

    const payload = req.body || {};
    const saved = await pricingService.saveConfig(
      {
        quoteToleranceMinor: payload.quoteToleranceMinor,
        regions: payload.regions,
        productFees: payload.productFees,
        effectiveAt: payload.effectiveAt ? new Date(payload.effectiveAt) : new Date(),
      },
      String(req["authUser"]._id)
    );
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: saved });
  };

  getHistory = async (req: Request, res: Response) => {
    const denied = assertAdminPermission(req["authUser"], "can_manage_pricing");
    if (denied) return res.status(403).json({ status: CONSTANCE.FAIL, msg: denied });
    const items = await pricingService.listHistory(Number(req.query.limit) || 10);
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: items });
  };

  previewQuote = async (req: Request, res: Response) => {
    const denied = assertAdminPermission(req["authUser"], "can_manage_pricing");
    if (denied) return res.status(403).json({ status: CONSTANCE.FAIL, msg: denied });

    const body = req.body || {};
    if (body.draftConfig) {
      const { invalidatePricingConfigCache, buildQuoteWithConfig } = await import(
        "../payments/pricingService"
      );
      invalidatePricingConfigCache();
      const quote = await buildQuoteWithConfig(body.draftConfig, {
        region: body.region || "US",
        productType: body.productType || "session_booking",
        sessionSubtotalCents: Number(body.sessionSubtotalCents || 10000),
        trainerId: body.trainerId,
        paymentMethodHint: body.paymentMethodHint,
        billingAddress: body.billingAddress,
        promoDiscountCents: Number(body.promoDiscountCents || 0),
      });
      return res.status(200).json({ status: CONSTANCE.SUCCESS, data: quote });
    }

    const quote = await pricingService.quote({
      region: req.body.region || "US",
      productType: req.body.productType || "session_booking",
      sessionSubtotalCents: Number(req.body.sessionSubtotalCents || 10000),
      trainerId: req.body.trainerId,
      paymentMethodHint: req.body.paymentMethodHint,
      billingAddress: req.body.billingAddress,
      promoDiscountCents: Number(req.body.promoDiscountCents || 0),
    });
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: quote });
  };

  getDefaults = async (_req: Request, res: Response) => {
    return res.status(200).json({ status: CONSTANCE.SUCCESS, data: DEFAULT_PRICING_CONFIG });
  };
}

export const pricingAdminController = new PricingAdminController();
