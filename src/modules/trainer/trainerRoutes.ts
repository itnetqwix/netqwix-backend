import { Router } from "express";
import { trainerController } from "./trainerController";
import { validator } from "../../validate";
import {
  updateProfileModal,
  updateSlotsModel,
} from "./trainerValidator/updateSlotsValidator";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { TrainerMiddleware } from "./trainerMiddleware";

const route: Router = Router();
const trainerC = new trainerController();
const V: validator = new validator();
const authorizeMiddleware = new AuthorizeMiddleware();
const trainerMiddleware = new TrainerMiddleware();

route.get("/top-trainers" , trainerC.getTrainers);

route.use([
  (req, res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.post(
  "/update-slots",
  trainerMiddleware.isTrainer,
  V.validate(updateSlotsModel),
  trainerC.updateSchedulingSlots
);

route.post(
  "/add-slot",
  trainerMiddleware.isTrainer,
  trainerC.addStot
);


route.post(
  "/update-slot",
  trainerMiddleware.isTrainer,
  trainerC.updateStot
);


route.post(
  "/delete-slot",
  trainerMiddleware.isTrainer,
  trainerC.deleteStot
);

route.post(
  "/get-availability",
  trainerC.getAvailability
);

route.get("/get-slots", trainerC.getSchedulingSlots);
route.get("/get-trainers", trainerC.getTrainers);

route.get("/get-recent-trainees", trainerC.recentTrainees);

route.post("/get-trainee-clips", trainerC.traineeClips);

// update profile
route.put("/profile", trainerC.updateProfile);
route.post("/create-money-request", trainerC.createMoneyRequest);
route.get("/get-money-request", trainerC.getAllMoneyRequest);

export const trainerRoute: Router = route;
