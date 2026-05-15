import { Request, Response } from "express";
import { PromoCodeService } from "./promoCodeService";
import { CONSTANCE } from "../../config/constance";
import { ResponseBuilder } from "../../helpers/responseBuilder";

export class PromoCodeController {
  private service = new PromoCodeService();

  // ─── Admin endpoints ──────────────────────────────────────────

  public create = async (req: Request, res: Response) => {
    try {
      const result = await this.service.createPromoCode(req.body, req["authUser"]);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] create error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public list = async (req: Request, res: Response) => {
    try {
      const result = await this.service.listPromoCodes(req["authUser"], req.query);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] list error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public getById = async (req: Request, res: Response) => {
    try {
      const result = await this.service.getPromoCodeById(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] getById error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public update = async (req: Request, res: Response) => {
    try {
      const result = await this.service.updatePromoCode(req["authUser"], req.params.id, req.body);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] update error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public remove = async (req: Request, res: Response) => {
    try {
      const result = await this.service.deletePromoCode(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] delete error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public toggle = async (req: Request, res: Response) => {
    try {
      const result = await this.service.togglePromoCode(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] toggle error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  public toggleVisibility = async (req: Request, res: Response) => {
    try {
      const result = await this.service.toggleVisibility(req["authUser"], req.params.id);
      return res.status(result.code).json(result);
    } catch (err) {
      console.error("[PromoCode] toggleVisibility error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };

  // ─── User-facing endpoints ────────────────────────────────────

  public validate = async (req: Request, res: Response) => {
    try {
      const { code, booking_type, amount } = req.body;
      const userId = req["authUser"]?._id;
      const userType = req["authUser"]?.account_type || "Trainee";

      if (!code) {
        return res.status(400).json({ valid: false, reason: "Promo code is required." });
      }

      const result = await this.service.validatePromoCode(
        code,
        userId,
        userType,
        booking_type,
        amount != null ? Number(amount) : undefined
      );

      if (!result.valid) {
        return res.status(200).json({ valid: false, reason: result.reason });
      }

      return res.status(200).json({
        valid: true,
        discount_type: result.promo.discount_type,
        discount_value: result.promo.discount_value,
        discount_amount: result.discount_amount,
        final_amount: result.final_amount,
        display_label: result.promo.display_label || result.promo.code,
      });
    } catch (err) {
      console.error("[PromoCode] validate error:", err);
      return res.status(500).json({ valid: false, reason: "Server error." });
    }
  };

  public visiblePromos = async (req: Request, res: Response) => {
    try {
      const userType = req["authUser"]?.account_type || "Trainee";
      const userLocation = (req.query.location as string) || undefined;

      const promos = await this.service.getVisiblePromos(userType, userLocation);

      return res.status(200).json({
        status: CONSTANCE.SUCCESS,
        data: promos,
      });
    } catch (err) {
      console.error("[PromoCode] visiblePromos error:", err);
      return res.status(500).json({ status: CONSTANCE.FAIL, error: "Server error." });
    }
  };
}
