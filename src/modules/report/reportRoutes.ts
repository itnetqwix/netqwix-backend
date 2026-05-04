import { Router } from "express";
import { reportController } from "./reportController";
import { validator } from "../../validate";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { TrainerMiddleware } from "./reportMiddleware";

const route: Router = Router();
const reportC = new reportController();
const V: validator = new validator();
const authorizeMiddleware = new AuthorizeMiddleware();
const reportMiddleware = new TrainerMiddleware();



route.use([
  (req, res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.post("", reportMiddleware.isTrainer, reportC.createReport);
route.post("/add-image", reportMiddleware.isTrainer, reportC.addImage);
route.post(
  "/add-session-recording",
  reportMiddleware.isTrainer,
  reportC.addSessionRecording
);
route.post("/remove-image", reportMiddleware.isTrainer, reportC.removeImage);
route.post("/crop-image", reportMiddleware.isTrainer, reportC.cropImage);
route.post("/get", reportMiddleware.isTrainer, reportC.getReport);
route.post("/get-all", reportC.getAllReport);
route.delete('/delete-report/:id', reportC.deleteReport) ;

export const reportRoute: Router = route;
