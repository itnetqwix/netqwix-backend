import { Router } from "express";
import { validator } from "../../validate";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { NotificationsController } from "./notificationsController";

const route: Router = Router();
const notificationsController = new NotificationsController();
const V: validator = new validator();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use([
    (req, res, next) => {
      req.byPassRoute = [];
      next();
    },
    authorizeMiddleware.authorizeUser,
  ]);

route.get('/', notificationsController.getNotifications);
route.get("/get-public-key", notificationsController.getPublicKey);
route.post("/subscription", notificationsController.getSubscription);
route.patch('/update', notificationsController.updateNotificationsStatus);

export const notificationRoute: Router = route;
