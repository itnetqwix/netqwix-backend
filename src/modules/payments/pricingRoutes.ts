import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { pricingController } from "./pricingController";

const route = Router();
const auth = new AuthorizeMiddleware();

route.post("/quote", auth.authorizeUser, pricingController.quote);
route.get("/quote/:quoteId", auth.authorizeUser, pricingController.getQuoteById);

export const paymentsRoute: Router = route;
