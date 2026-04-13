import { Router } from "express";
import { userController } from "./userController";
import { validator } from "../../validate";
import { signUpModel, updateBookedStatusModal, updateRatings } from "./userValidator";
import { IsValidMongoId } from "../../middleware/isValidToken.middleware";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { userMiddleware } from './userMiddleware';

const isValidMongoMiddleware = new IsValidMongoId();
const route: Router = Router();
const userC = new userController();
const userM = new userMiddleware();
// const middleware = new Middleware();
const authorizeMiddleware = new AuthorizeMiddleware();

const V: validator = new validator();

route.use([
  (req, res, next) => {
    req.byPassRoute = [
      '/sign-up',
      '/stripe-account-verification',
      '/all-online-user'
    ];
    
    if (req.path.startsWith('/approve-expert/')) {
      return next();
    }
    
    if (req.byPassRoute.includes(req.path)) {
      return next();
    }
    
    authorizeMiddleware.authorizeUser(req, res, next);
  }
]);

route.post(
  "/sign-up",
  V.validate(signUpModel),
  userC.createNewUser
);


// to update status of booked session
route.put(
  "/update-booked-session/:id",
  isValidMongoMiddleware.isValidTokenInReqParams,
  V.validate(updateBookedStatusModal),
  userC.updateBookedSession
);

// to get scheduled bookings for trainer / trainee
route.get(
  "/scheduled-meetings",
  userC.getScheduledMeetings
);

route.get(
  "/me",
  userC.getMe
);


route.post(
  "/share-clips",
  userC.shareClips
);

route.post(
  "/invite-friend",
  userC.inviteFriend
);

// to add/update rating for trainer and trainee
route.put('/rating', V.validate(updateRatings), userM.isBookingExist, userC.updateRatings);


// to add trainee clip in booked session
route.put(
  "/add-trainee-clip/:id",
  isValidMongoMiddleware.isValidTokenInReqParams,
  userC.addTraineeClip);

route.post("/send-friend-request", userC.sendFriendRequest);
route.post("/accept-friend-request", userC.acceptFriendRequest);
route.post("/cancel-friend-request", userC.cancelFriendRequest);
route.post("/reject-friend-request", userC.rejectFriendRequest);
route.get("/friend-requests", userC.getFriendRequests);
route.get("/friends", userC.getFriends);
route.post("/remove-friend", userC.removeFriend);
route.post("/update-account-privacy",userC.updateIsPrivate);
route.get("/get-all-trainee",userC.getAllTrainee);
route.get("/get-all-users",userC.getAllUsers);
route.get("/get-all-trainer",userC.getAllTrainers);
route.put("/update-trainer-commission",userC.updateTrainerCommossion);
route.post("/register-user-with-stripe",userC.updateIsRegisteredWithStript);
route.put("/update-kyc-status",userC.updateIsKYCCompleted);
route.put("/create-verification-session",userC.createVerificationSessionStripeKYC);
route.get("/booking-list",userC.getAllBooking);
route.get("/booking-list-by-id",userC.getAllBookingById);
route.put("/stripe-account-verification",userC.createStripeAccountVarificationUrl);
route.get("/check-stripe-verification",userC.checkIsKycCompleted);
route.post("/update-refund-status",userC.updateRefundStatus);
route.post("/write-us",userC.captureWriteUs);
route.post("/raise-concern",userC.createRaiseConcern);
route.get("/write-us",userC.getCaptureWriteUs);
route.get("/raise-concern",userC.getRaiseConcern);
route.put("/update-contact-us-status",userC.updateWriteUsTicketStatus);
route.put("/update-raised-concern-ticket",userC.updateRaiseConcernTicketStatus);
route.get("/all-online-user",userC.getAllLatestOnlineUser);
route.put("/update-mobile-number",userC.updateMobileNumber);
route.patch("/update-notifications-settings",userC.updateNotificationSettings);
route.put("/update-trainer-status",userC.updateTrainerStatus.bind(userC));
route.get("/approve-expert/:id",userC.approveTrainer.bind(userC));


export const userRoute: Router = route;
