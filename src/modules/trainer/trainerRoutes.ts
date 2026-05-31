import { Router } from "express";
import { trainerController } from "./trainerController";
import { validator } from "../../validate";
import {
  updateProfileModal,
  updateSlotsModel,
} from "./trainerValidator/updateSlotsValidator";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { TrainerMiddleware } from "./trainerMiddleware";
import { sessionExtensionRespondModal } from "../trainee/sessionExtensionValidator";
import {
  idempotentHandler,
  requireIdempotencyKey,
} from "../../middleware/idempotency.middleware";

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

// Signed-in trainer's own rating + recent reviews aggregate, for the
// dashboard rating-pulse widget. Falls back to {} when the trainer has
// no completed reviews yet.
route.get("/my-stats", trainerMiddleware.isTrainer, trainerC.getMyStats);

route.post("/get-trainee-clips", trainerC.traineeClips);

// update profile
route.put("/profile", trainerC.updateProfile);
route.post("/create-money-request", trainerC.createMoneyRequest);
route.get("/get-money-request", trainerC.getAllMoneyRequest);

route.post(
  "/instant-lesson/accept",
  trainerMiddleware.isTrainer,
  requireIdempotencyKey,
  trainerC.acceptInstantLesson
);
route.post(
  "/instant-lesson/decline",
  trainerMiddleware.isTrainer,
  requireIdempotencyKey,
  trainerC.declineInstantLesson
);

/** Two-party paid extension: trainer accepts/rejects a pending request. */
route.post(
  "/session-extension/respond",
  trainerMiddleware.isTrainer,
  requireIdempotencyKey,
  V.validate(sessionExtensionRespondModal),
  idempotentHandler(trainerC.respondToSessionExtensionRequest)
);

route.get(
  "/trainee-notes/:traineeId",
  trainerMiddleware.isTrainer,
  trainerC.getTraineeNote
);
route.put(
  "/trainee-notes/:traineeId",
  trainerMiddleware.isTrainer,
  trainerC.upsertTraineeNote
);
route.delete(
  "/trainee-notes/:traineeId",
  trainerMiddleware.isTrainer,
  trainerC.deleteTraineeNote
);
route.get(
  "/nudge-candidates",
  trainerMiddleware.isTrainer,
  trainerC.getNudgeCandidates
);
route.post(
  "/trainee-nudge",
  trainerMiddleware.isTrainer,
  trainerC.sendTraineeNudge
);

route.post(
  "/session-recap",
  trainerMiddleware.isTrainer,
  trainerC.postSessionRecap
);

export const trainerRoute: Router = route;
