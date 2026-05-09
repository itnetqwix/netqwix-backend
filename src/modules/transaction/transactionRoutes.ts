import { Router } from "express";
import { transactionController } from "./transactionController";
import { validator } from "../../validate";
import { createPaymentIntent } from "./transactionValidator";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const transactionC = new transactionController();
const V: validator = new validator();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use((req: any, res, next) => {
  if (!req.byPassRoute) req.byPassRoute = [];
  next();
});

route.post("/create-payment-intent", V.validate(createPaymentIntent), transactionC.createPaymentIntent);
route.post("/get-payment-intent", authorizeMiddleware.authorizeUser, transactionC.paymentDetailsByPaymentIntentsId);
route.post("/create-refund", authorizeMiddleware.authorizeUser, transactionC.createRefundByIntentId);

export const transactionRoute: Router = route;
