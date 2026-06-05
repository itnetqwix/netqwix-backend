import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { Request, Response } from "express";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { transactionService } from "./transactionService";
import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import admin_audit from "../../model/admin_audit.schema";
import { assertAdminPermission, assertAdminUser } from "../admin/adminPermission";
const stripe = require("stripe")(process.env.STRIPE_SECRET);

export class transactionController {
  public logger = log.getLogger();
  public transactionService = new transactionService();

  public createPaymentIntent = async (req: Request, res: Response) => {
    try {
      const { amount, couponCode } = req.body;
      const amountNum = Number(amount);
      const hasCoupon =
        typeof couponCode === "string" && couponCode.trim().length > 0;
      if (
        amount == null ||
        Number.isNaN(amountNum) ||
        amountNum < 0 ||
        (amountNum === 0 && !hasCoupon)
      ) {
        return res.send({
          status: CONSTANCE.BAD_DATA,
          msg: "Invalid amount provided amount should be a positive number",
        });
      }
      const payloadWithUser = {
        ...req.body,
        _userId: req["authUser"]?._id,
        _userType: req["authUser"]?.account_type,
      };
      const result: ResponseBuilder =
        await this.transactionService.createPaymentIntent(payloadWithUser);
      switch (result.code) {
        case 200:
          return res
            .status(result.code)
            .send({ status: CONSTANCE.SUCCESS, data: result.result });
        case 400:
          return res
            .status(
              result.code
                ? result.code
                : CONSTANCE.RES_CODE.error.internalServerError
            )
            .send({ status: CONSTANCE.FAIL, error: result.error["error"] });

        default:
          return res
            .status(result.code)
            .send({ status: CONSTANCE.SUCCESS, data: result.result });
      }
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public paymentDetailsByPaymentIntentsId = async (
    req: Request,
    res: Response
  ) => {
    try {
      const denied = assertAdminUser(req["authUser"]);
      if (denied) {
        return res.status(403).json({ status: CONSTANCE.FAIL, error: denied });
      }
      const { payment_intent_id } = req.body;
      const intent = await stripe.paymentIntents.retrieve(payment_intent_id);

      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: intent });
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };

  public createRefundByIntentId = async (req: Request, res: Response) => {
    try {
      const perm = assertAdminPermission(req["authUser"], "can_process_refund");
      if (perm) {
        return res.status(403).json({ status: CONSTANCE.FAIL, error: perm });
      }
      const { payment_intent_id, booking_id, reason } = req.body;
      if (!payment_intent_id || !booking_id) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "payment_intent_id and booking_id are required",
        });
      }
      const reasonStr = String(reason || "").trim();
      if (reasonStr.length < 3) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "Refund reason is required (min 3 characters)",
        });
      }
      if (!mongoose.isValidObjectId(booking_id)) {
        return res.status(400).json({ status: CONSTANCE.FAIL, error: "Invalid booking_id" });
      }
      const { processAdminRefundByPaymentIntent } = require("../wallet/adminRefundService");
      const result = await processAdminRefundByPaymentIntent({
        paymentIntentId: payment_intent_id,
        bookingId: booking_id,
        reason: reasonStr,
        adminUserId: req["authUser"]?._id,
      });

      return res.status(200).send({
        status: CONSTANCE.SUCCESS,
        data: result.refund ?? { path: result.path, escrowHoldId: result.escrowHoldId },
      });
    } catch (error) {
      this.logger.error(error);
      return res
        .status(
          error.code ? error.code : CONSTANCE.RES_CODE.error.internalServerError
        )
        .send({ status: CONSTANCE.FAIL, error: error.message });
    }
  };
}
