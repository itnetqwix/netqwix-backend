import { Router } from "express";
import { transactionController } from "./transactionController";
import { validator } from "../../validate";
import { createPaymentIntent } from "./transactionValidator";


const route: Router = Router();
const transactionC = new transactionController();
const V: validator = new validator();
route.post("/create-payment-intent", V.validate(createPaymentIntent), transactionC.createPaymentIntent);
route.post("/get-payment-intent", transactionC.paymentDetailsByPaymentIntentsId);
route.post("/create-refund", transactionC.createRefundByIntentId);

export const transactionRoute: Router = route;
