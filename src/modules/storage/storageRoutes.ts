import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { clipConfirmService } from "./clipConfirmService";
import { clipPresignService } from "./clipPresignService";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use(authorizeMiddleware.authorizeUser);

/** Month 2 — canonical presigned PUT for locker / instant-lesson clips */
route.post("/clips/presign", (req, res) => clipPresignService.presignHandler(req, res));
route.post("/clips/confirm", (req, res) => clipConfirmService.confirmHandler(req, res));

export const storageRoute: Router = route;
