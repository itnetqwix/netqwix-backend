import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { referralService } from "./referralService";
import { AccountType } from "../auth/authEnum";
import { computeBookingCheckoutDiscounts } from "./referralCheckoutDiscount";
import { ResponseBuilder } from "../../helpers/responseBuilder";

export class ReferralController {
  public getProgram = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await referralService.getProgram(authUser);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public resolveCode = async (req: Request, res: Response) => {
    try {
      const code = req.params.code;
      const result = await referralService.resolveCode(code);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public resolveReferrer = async (req: Request, res: Response) => {
    try {
      const result = await referralService.resolveReferrerId(req.params.userId);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public sendInvites = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
      const target =
        req.body?.targetAccountType === AccountType.TRAINER
          ? AccountType.TRAINER
          : AccountType.TRAINEE;
      const result = await referralService.sendInvites(authUser, emails, target);
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public listInvites = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await referralService.listInvites(String(authUser._id));
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public getBenefits = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await referralService.getRefereeBenefits(String(authUser._id));
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public previewCheckout = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json(ResponseBuilder.badRequest("Invalid amount.").result);
      }
      const bookingType =
        req.body?.booking_type === "instant" ? "instant" : "scheduled";
      const checkout = await computeBookingCheckoutDiscounts({
        traineeId: String(authUser._id),
        originalPrice: amount,
        bookingType,
        couponCode: req.body?.coupon_code,
        trainerId: req.body?.trainer_id ? String(req.body.trainer_id) : undefined,
      });
      if (checkout.promoError) {
        return res.status(400).json(ResponseBuilder.badRequest(checkout.promoError).result);
      }
      return res.status(200).json(
        ResponseBuilder.data(
          {
            ...checkout,
            stacksWithPromo: true,
            label: checkout.referralEligible
              ? "Referral first lesson discount"
              : null,
          },
          "Checkout preview"
        ).result
      );
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };

  public listRewards = async (req: Request, res: Response) => {
    try {
      const authUser = req["authUser"];
      if (!authUser?._id) return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
      const result = await referralService.listRewards(String(authUser._id));
      return res.status(result.code).json(result.result);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err?.message });
    }
  };
}

export const referralController = new ReferralController();
