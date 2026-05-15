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
      const { amount } = req.body;
      if (!amount) {
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
      const booking: any = await booked_session.findById(booking_id).lean();
      if (!booking) {
        return res.status(400).json({ status: CONSTANCE.FAIL, error: "Booking not found" });
      }
      if (String(booking.refund_status) === "refunded") {
        return res.status(400).json({ status: CONSTANCE.FAIL, error: "Booking is already refunded" });
      }
      if (String(booking.payment_intent_id || "") !== String(payment_intent_id)) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "Payment intent does not match this booking",
        });
      }

      const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
      const latest_charge = intent.latest_charge;
      if (!latest_charge) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "No charge available for refund",
        });
      }

      const bid = new mongoose.Types.ObjectId(booking_id);
      const existingRefundAudit = await admin_audit.findOne({
        entity_type: "booked_session",
        entity_id: bid,
        action: "stripe_refund",
      });
      if (existingRefundAudit) {
        return res.status(400).json({
          status: CONSTANCE.FAIL,
          error: "A refund was already recorded for this booking",
        });
      }

      const refund = await stripe.refunds.create({
        charge: latest_charge,
        reverse_transfer: true,
        refund_application_fee: true,
      });

      const auditRow = await admin_audit.create({
        admin_id: req["authUser"]?._id,
        target_user_id: booking.trainee_id || booking.trainer_id || undefined,
        entity_type: "booked_session",
        entity_id: bid,
        action: "stripe_refund",
        reason: reasonStr,
        meta: { payment_intent_id, stripe_refund_id: refund.id },
      });

      const { recordOpsEvent } = require("../ops/opsEventService");
      recordOpsEvent({
        category: "payment",
        severity: "info",
        event_type: "STRIPE_REFUND",
        user_id: booking.trainee_id,
        related_user_id: booking.trainer_id,
        session_id: booking_id,
        title: "Stripe refund processed",
        summary: reasonStr,
        payload: auditRow.meta,
        source: "admin",
        idempotency_key: `admin_audit:${auditRow._id}`,
      });

      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: refund });
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
