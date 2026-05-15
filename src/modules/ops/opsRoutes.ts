import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { opsIngestController } from "./opsIngestController";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.post("/events/report", authorizeMiddleware.authorizeUser, opsIngestController.report);

export const opsRoute: Router = route;
