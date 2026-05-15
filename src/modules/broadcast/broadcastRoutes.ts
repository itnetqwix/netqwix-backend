import { Router } from "express";
import { BroadcastController } from "./broadcastController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const controller = new BroadcastController();

route.use([
  (req, _res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.post("/", controller.create);
route.get("/", controller.list);
route.get("/preview-count", controller.previewCount);
route.get("/:id", controller.getById);
route.post("/:id/resend", controller.resend);
route.delete("/:id", controller.remove);

export const broadcastRoute: Router = route;
