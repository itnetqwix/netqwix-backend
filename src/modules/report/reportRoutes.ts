import { Router } from "express";
import { reportController } from "./reportController";
import { validator } from "../../validate";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { TrainerMiddleware } from "./reportMiddleware";
import {
  reportAddImageModal,
  reportCropImageModal,
  reportGetModal,
  reportRemoveImageModal,
  reportSessionBodyModal,
  reportSessionRecordingModal,
} from "./reportValidator";

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

route.post(
  "",
  reportMiddleware.isTrainer,
  V.validate(reportSessionBodyModal),
  reportC.createReport
);
route.post(
  "/add-image",
  reportMiddleware.isTrainer,
  V.validate(reportAddImageModal),
  reportC.addImage
);
route.post(
  "/add-session-recording",
  reportMiddleware.isTrainer,
  V.validate(reportSessionRecordingModal),
  reportC.addSessionRecording
);
route.post(
  "/remove-image",
  reportMiddleware.isTrainer,
  V.validate(reportRemoveImageModal),
  reportC.removeImage
);
route.post(
  "/crop-image",
  reportMiddleware.isTrainer,
  V.validate(reportCropImageModal),
  reportC.cropImage
);
route.post(
  "/get",
  reportMiddleware.isTrainer,
  V.validate(reportGetModal),
  reportC.getReport
);
route.post("/get-all", reportC.getAllReport);
route.delete(
  "/delete-report/:id",
  reportMiddleware.isTrainer,
  reportC.deleteReport
);

export const reportRoute: Router = route;
