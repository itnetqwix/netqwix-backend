import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { pointsController } from "./pointsController";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.get("/catalog", pointsController.catalog);

route.use(authorizeMiddleware.authorizeUser);

route.get("/balance", pointsController.balance);
route.get("/ledger", pointsController.ledger);
route.post("/redeem", pointsController.redeem);

export const pointsRoute: Router = route;
