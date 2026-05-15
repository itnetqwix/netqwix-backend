import { Router, Request, Response } from "express";
import * as express from "express";
import { stripeWebhookService } from "./stripeWebhookService";
import { CONSTANCE } from "../../config/constance";

const route = Router();

route.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const signature = req.headers["stripe-signature"] as string;
      if (!signature) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "Missing signature" });
      }
      const result = await stripeWebhookService.handleEvent(req.body as Buffer, signature);
      return res.status(200).send(result);
    } catch (err: any) {
      console.error("[StripeWebhook]", err);
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  }
);

export const webhookRoute: Router = route;
