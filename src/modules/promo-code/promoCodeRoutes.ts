import { Router } from "express";
import { PromoCodeController } from "./promoCodeController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const controller = new PromoCodeController();

route.use([
  (req, _res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.post("/", controller.create);
route.get("/", controller.list);
route.get("/:id", controller.getById);
route.put("/:id", controller.update);
route.delete("/:id", controller.remove);
route.patch("/:id/toggle", controller.toggle);
route.patch("/:id/visibility", controller.toggleVisibility);

export const promoCodeRoute: Router = route;
