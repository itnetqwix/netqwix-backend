import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { traineeController } from "./traineeController";
import { validator } from "../../validate";

import {
  bookSessionModal,
  bookInstantMeetingModal,
  checkSlotExistModal,
} from "./traineeValidator";
import {
  sessionExtensionCancelModal,
  sessionExtensionConfirmModal,
  sessionExtensionPaymentIntentModal,
  sessionExtensionRequestModal,
} from "./sessionExtensionValidator";
import { TraineeMiddleware } from "./traineeMiddleware";
import { idempotentHandler, requireIdempotencyKey } from "../../middleware/idempotency.middleware";

const route: Router = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const traineeC = new traineeController();
const traineeMiddleware = new TraineeMiddleware();

route.use([
  (req, res, next) => {
    req.byPassRoute = ["/get-trainers-with-slots","/check-slot"];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

const V: validator = new validator();

route.get("/get-trainers-with-slots", traineeC.getSlotsOfAllTrainers);
route.post(
  "/book-session",
  requireIdempotencyKey,
  V.validate(bookSessionModal),
  idempotentHandler(traineeC.bookSession)
);
route.post(
  "/book-instant-meeting",
  traineeMiddleware.isTrainee,
  requireIdempotencyKey,
  V.validate(bookInstantMeetingModal),
  idempotentHandler(traineeC.bookInstantMeeting)
);
route.get(
  "/instant-lesson/eligibility",
  traineeMiddleware.isTrainee,
  traineeC.getInstantLessonEligibility
);

// update profile
route.put("/profile", traineeC.updateProfile);

// check slot available in given time and for trainer
route.post(
  "/check-slot",
  V.validate(checkSlotExistModal),
  traineeC.checkSlotExist
);
route.get('/recent-trainers' , traineeC.recentTrainers)

route.get("/favorite-trainers", traineeMiddleware.isTrainee, traineeC.listFavoriteTrainers);
route.post(
  "/favorite-trainers/:trainerId",
  traineeMiddleware.isTrainee,
  traineeC.addFavoriteTrainer
);
route.delete(
  "/favorite-trainers/:trainerId",
  traineeMiddleware.isTrainee,
  traineeC.removeFavoriteTrainer
);

route.post(
  "/guest-activity",
  traineeMiddleware.isTrainee,
  traineeC.ingestGuestActivity
);
route.get(
  "/guest-activity/seeded-trainers",
  traineeMiddleware.isTrainee,
  traineeC.getGuestSeededTrainers
);
route.get(
  "/personalized-feed",
  traineeMiddleware.isTrainee,
  traineeC.getPersonalizedFeed
);

route.get(
  "/session-extension/quote",
  traineeMiddleware.isTrainee,
  traineeC.getSessionExtensionQuote
);
route.post(
  "/session-extension/request",
  traineeMiddleware.isTrainee,
  requireIdempotencyKey,
  V.validate(sessionExtensionRequestModal),
  idempotentHandler(traineeC.requestSessionExtension)
);
route.post(
  "/session-extension/cancel-request",
  traineeMiddleware.isTrainee,
  V.validate(sessionExtensionCancelModal),
  traineeC.cancelSessionExtensionRequest
);
route.post(
  "/session-extension/create-payment-intent",
  traineeMiddleware.isTrainee,
  V.validate(sessionExtensionPaymentIntentModal),
  traineeC.createSessionExtensionPaymentIntent
);
route.post(
  "/session-extension/confirm",
  traineeMiddleware.isTrainee,
  requireIdempotencyKey,
  V.validate(sessionExtensionConfirmModal),
  idempotentHandler(traineeC.confirmSessionExtension)
);

export const traineeRoute: Router = route;
