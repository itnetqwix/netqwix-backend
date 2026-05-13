import * as express from "express";
import { userRoute } from "./src/modules/user/userRoutes";
import { authRoute } from "./src/modules/auth/authRoutes";
import { masterRoute } from "./src/modules/master/masterRoutes";
import { trainerRoute } from "./src/modules/trainer/trainerRoutes";
import { reportRoute } from "./src/modules/report/reportRoutes";
import { traineeRoute } from "./src/modules/trainee/traineeRoute";
import { transactionRoute } from "./src/modules/transaction/transactionRoutes";
import { commonRoute } from "./src/modules/common/commonRoutes";
import { adminRoute } from "./src/modules/admin/adminRoutes";
import { notificationRoute } from "./src/modules/notifications/notificationsRoutes";
import chatRoute from "./src/modules/chat/chatRoutes";
export class Routes {
  protected app: express.Application;
  constructor() {}

  public routePath() {
    const router: express.Router = express.Router();
    router.use("/user", userRoute);
    router.use("/auth", authRoute);
    router.use("/master", masterRoute);
    router.use("/trainer", trainerRoute);
    router.use("/trainee", traineeRoute);
    router.use("/transaction", transactionRoute);
    router.use("/common", commonRoute);
    router.use("/report", reportRoute);
    router.use("/admin", adminRoute);
    router.use("/notifications", notificationRoute);
    router.use("/chat", chatRoute);
    router.get("/", (req, res) => {
      res.send("Welcome to NetQwix :) ");
    });
    return router;
  }
}
