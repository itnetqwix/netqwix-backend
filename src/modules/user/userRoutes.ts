import { Router } from "express";
import { userController } from "./userController";
import { validator } from "../../validate";
import { signUpModel, updateBookedStatusModal, updateRatings } from "./userValidator";
import { IsValidMongoId } from "../../middleware/isValidToken.middleware";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { userMiddleware } from './userMiddleware';
import { storageController } from "../storage/storageController";
import {
  listBlockedUsers,
  unblockUser,
  updateProfileVisibility,
  requestDataExport,
  dataExportStatus,
  twoFactorStatus,
  twoFactorEnable,
  twoFactorChallenge,
  twoFactorVerify,
  twoFactorDisable,
  listTrustedDevices,
  revokeTrustedDevice,
} from "./userPrivacyController";
import {
  requestAccountDeletion,
  confirmAccountDeletion,
  cancelAccountDeletion,
  requestHibernate,
  confirmHibernate,
  getLifecycleState,
} from "./accountLifecycleController";

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
    ];
    
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

route.get("/storage", storageController.getStorage);
route.post("/storage/checkout", storageController.createCheckout);

route.put("/me/chat-public-key", userC.setChatPublicKey);
route.get(
  "/:id/chat-public-key",
  isValidMongoMiddleware.isValidTokenInReqParams,
  userC.getChatPublicKey
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
route.get("/sent-friend-requests", userC.getSentFriendRequests);
route.get("/friends", userC.getFriends);
route.post("/remove-friend", userC.removeFriend);
route.post("/block-user", userC.blockUser);
route.get("/blocked-users", listBlockedUsers);
route.post("/unblock-user", unblockUser);
route.post("/report-user", userC.reportUser);
route.post("/update-account-privacy", userC.updateIsPrivate);
route.patch("/update-profile-visibility", updateProfileVisibility);

route.post("/data-export/request", requestDataExport);
route.get("/data-export/status", dataExportStatus);

route.get("/2fa/status", twoFactorStatus);
route.post("/2fa/enable", twoFactorEnable);
route.post("/2fa/disable", twoFactorDisable);
route.post("/2fa/challenge", twoFactorChallenge);
route.post("/2fa/verify", twoFactorVerify);
route.get("/2fa/trusted-devices", listTrustedDevices);
route.delete("/2fa/trusted-devices/:id", revokeTrustedDevice);
route.get("/get-all-trainee",userC.getAllTrainee);
route.get("/get-all-users",userC.getAllUsers);
route.get("/get-all-trainer",userC.getAllTrainers);
route.put("/update-trainer-commission",userC.updateTrainerCommossion);
route.post("/register-user-with-stripe",userC.updateIsRegisteredWithStript);
route.put("/update-kyc-status",userC.updateIsKYCCompleted);
route.put("/create-verification-session",userC.createVerificationSessionStripeKYC);
route.get("/booking-list",userC.getAllBooking);
route.get("/booking-list-by-id",userC.getAllBookingById);
route.get("/booking/:bookingId",userC.getBookingById);
route.get("/session-detail/:bookingId", userC.getSessionDetail);
route.get("/session-join-readiness/:bookingId", userC.getSessionJoinReadiness);
route.get("/session-handoff/:bookingId", userC.getSessionHandoffSummary);
route.put("/stripe-account-verification",userC.createStripeAccountVarificationUrl);
route.get("/check-stripe-verification",userC.checkIsKycCompleted);
route.post("/update-refund-status",userC.updateRefundStatus);
route.post("/write-us",userC.captureWriteUs);
route.post("/raise-concern",userC.createRaiseConcern);
route.get("/write-us",userC.getCaptureWriteUs);
route.get("/raise-concern",userC.getRaiseConcern);
route.get("/my-raise-concerns",userC.getMyRaiseConcerns);
route.get("/my-referrals",userC.getMyReferrals);
route.put("/update-contact-us-status",userC.updateWriteUsTicketStatus);
route.put("/update-raised-concern-ticket",userC.updateRaiseConcernTicketStatus);
route.get("/all-online-user",userC.getAllLatestOnlineUser);
route.put("/update-mobile-number",userC.updateMobileNumber);
route.patch("/update-notifications-settings",userC.updateNotificationSettings);
route.put("/update-trainer-status",userC.updateTrainerStatus.bind(userC));
route.put("/online-availability", userC.setOnlineAvailability.bind(userC));
route.put(
  "/auto-decline-outside-hours",
  userC.setAutoDeclineOutsideHours.bind(userC)
);
route.delete("/delete-user/:id", isValidMongoMiddleware.isValidTokenInReqParams, userC.deleteUser.bind(userC));
route.delete("/me", userC.deleteOwnAccount.bind(userC));

route.get("/me/lifecycle", getLifecycleState);
route.post("/me/deletion/request", requestAccountDeletion);
route.post("/me/deletion/confirm", confirmAccountDeletion);
route.post("/me/deletion/cancel", cancelAccountDeletion);
route.post("/me/hibernate/request", requestHibernate);
route.post("/me/hibernate/confirm", confirmHibernate);
route.get("/approve-expert/:id",userC.approveTrainer.bind(userC));


export const userRoute: Router = route;
