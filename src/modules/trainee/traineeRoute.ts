import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { traineeController } from "./traineeController";
import { validator } from "../../validate";

import {
  bookSessionModal,
  bookInstantMeetingModal,
  checkSlotExistModal,
} from "./traineeValidator";
import { TraineeMiddleware } from "./traineeMiddleware";

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
route.post("/book-session", V.validate(bookSessionModal), traineeC.bookSession);
route.post(
  "/book-instant-meeting",
  traineeMiddleware.isTrainee,
  V.validate(bookInstantMeetingModal),
  traineeC.bookInstantMeeting
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
export const traineeRoute: Router = route;
