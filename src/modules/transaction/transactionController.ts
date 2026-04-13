import { log } from "../../../logger";
import { CONSTANCE } from "../../config/constance";
import { Request, Response } from "express";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { transactionService } from "./transactionService";
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
      const result: ResponseBuilder =
        await this.transactionService.createPaymentIntent(req.body);
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
      const { payment_intent_id } = req.body;
      const intent = await stripe.paymentIntents.retrieve(payment_intent_id);

      const latest_charge = intent.latest_charge;

      const refund = await stripe.refunds.create({
        charge: latest_charge,
        reverse_transfer: true,
        refund_application_fee: true,
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
