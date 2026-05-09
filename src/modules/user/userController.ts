import { log } from "./../../../logger";
import { CONSTANCE, Message, NetquixImage } from "./../../config/constance";
import { ResponseBuilder } from "./../../helpers/responseBuilder";
import { Request, Response } from "express";
import { UserService } from "./userService";
import { updateBookedStatusModal } from "./userValidator";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { SendEmail } from "../../Utils/sendEmail";

export class userController {
  public userService = new UserService();
  public logger = log.getLogger();
  public createNewUser = async (req: any, res: Response) => {
    try {
      const result: ResponseBuilder = await this.userService.createNewUser(
        req.model
      );
      return res
        .status(result.code)
        .send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err) {
      this.logger.error(err);
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateBookedSession = async (req, res) => {
    try {
      const { id } = req["params"];
      const result: ResponseBuilder =
        await this.userService.updateBookedSession(
          req.body as updateBookedStatusModal,
          id,
          req?.authUser?.account_type
        );
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result.result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getScheduledMeetings = async (req, res) => {
    try {
      const result: ResponseBuilder =
        await this.userService.getScheduledMeetings(req);
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result.result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getMe = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.userService.getMe(
          req.authUser
        );
        var newResult = JSON.parse(JSON.stringify(result.result));
        if (result.status !== CONSTANCE.FAIL) {
          if (req?.authUser?.account_type === "Trainer") {
            const ratingBookings = await booked_session.find(
              {
                trainer_id: req?.authUser?._id,
                "ratings.trainee.recommendRating": { $exists: true, $ne: null },
              },
              {
                "ratings.trainee.recommendRating": 1,
              }
            );

            const totalRating = ratingBookings.length;
            const avgRatingNumber = ratingBookings.reduce((acc, booking) => {
              const value = Number(booking?.ratings?.trainee?.recommendRating || 0);
              return acc + (Number.isFinite(value) ? value : 0);
            }, 0);

            newResult.userInfo.rating_summary = {
              ratingRatio: totalRating ? Number((avgRatingNumber / totalRating).toFixed(2)) : 0,
              totalRating,
            };
          }
          res.status(result.code).json(newResult);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public shareClips = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.userService.shareClips({
          ...req.body,
          ...req.authUser,
        });
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result.result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public inviteFriend = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.userService.inviteFriend({
          ...req.body,
          ...req.authUser,
        });
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result.result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateRatings = async (req, res) => {
    try {
      const result: ResponseBuilder = await this.userService.updateRatings(
        req.authUser,
        req["model"],
        req["booked_session_info"]
      );
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result.result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public addTraineeClip = async (req, res) => {
    try {
      const { id } = req["params"];
      const result: ResponseBuilder = await this.userService.addTraineeClip(
        req.body,
        id
      );
      if (result.status !== CONSTANCE.FAIL)
        res.status(result.code).json(result.result);
      else
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAllTrainee = async (req, res) => {
    try {
      if (req["authUser"]) {
        const searchTerm = req?.query?.search ? String(req.query.search) : undefined;
        const result: ResponseBuilder = await this.userService.getAllTrainee(
          req.authUser,
          searchTerm
        );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAllTrainers = async (req, res) => {
    try {
      if (req["authUser"]) {
        const searchTerm = req?.query?.search ? String(req.query.search) : undefined;
        const result: ResponseBuilder = await this.userService.getAllTrainers(
          req.authUser,
          searchTerm
        );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAllUsers = async (req, res) => {
    try {
      if (req["authUser"]) {
        // Extract the search term from the query parameter
        const searchTerm = req?.query?.search;
        const result: ResponseBuilder = await this.userService.getAllUsers(
          req.authUser,
          searchTerm
        );
        result.result = result.result.filter(user => user.account_type !== "Admin");

        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateTrainerCommossion = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateTrainerCommossion(req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateIsRegisteredWithStript = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateIsRegisteredWithStript(
            req.authUser,
            req.body
          );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateIsKYCCompleted = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateIsKYCCompleted(req.authUser);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateMobileNumber = async (req, res) => {
    try {
      if (req["authUser"]) {
        const { oldPhoneNumber, newPhoneNumber } = req.body;
        const result: ResponseBuilder =
          await this.userService.updateMobileNumber(req.authUser, { old: oldPhoneNumber, new: newPhoneNumber });
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateNotificationSettings = async (req, res) => {
    try {
      if (req["authUser"]) {
        const { notifications } = req.body;
        const result: ResponseBuilder =
          await this.userService.updateNotificationSettings(req.authUser, notifications);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public sendFriendRequest = async (req, res) => {
    const { receiverId } = req.body;
    const senderId = req.authUser._id.toString();

    if (senderId === receiverId) {
      return res
        .status(400)
        .json({ error: "You cannot send a friend request to yourself." });
    }

    try {
      const [receiver, sender] = await Promise.all([
        user.findById(receiverId),
        user.findById(senderId)
      ]);

      if (!receiver || !sender) {
        return res.status(404).json({ error: "User not found." });
      }

      if (sender.isPrivate) {
        return res.status(400).json({
          error: "Your account is private, you cannot send a friend request.",
        });
      }

      // Check if already friends
      const isAlreadyFriend = sender.friends.some(
        friendId => friendId.toString() === receiverId
      );
      if (isAlreadyFriend) {
        return res.status(400).json({ error: "You are already friends with this user." });
      }

      // Check for existing request in either direction
      const existingRequest = receiver.friendRequests.find(
        request => request.senderId.toString() === senderId
      );
      if (existingRequest) {
        return res.status(400).json({ error: "Friend request already sent." });
      }

      const pendingRequestFromReceiver = sender.friendRequests.find(
        request => request.senderId.toString() === receiverId
      );
      if (pendingRequestFromReceiver) {
        return res.status(400).json({
          error: "This user has already sent you a friend request. Please accept that instead."
        });
      }

      // Add friend request with duplicate check
      if (!receiver.friendRequests.some(req => req.senderId.toString() === senderId)) {
        receiver.friendRequests.push({ senderId, receiverId });
        await receiver.save();
      }

      SendEmail.sendRawEmail(
        "friend-request",
        {
          "[USER FULL NAME]": sender.fullname,
          "[TRAINER/TRAINEE NAME]": sender.fullname,
          "[USER_PROFILE_PIC]": `https://data.netqwix.com/${sender.profile_picture}`
        },
        [receiver.email],
        `NetQwix Friend Request from ${sender.fullname}`,
      );

      res.status(200).json({ message: "Friend request sent successfully." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public acceptFriendRequest = async (req, res) => {
    const { requestId } = req.body;
    const userId = req.authUser._id;
    try {
      const userDoc = await user.findById(userId);
      if (!userDoc) {
        return res.status(404).json({ error: "User not found." });
      }

      if (userDoc.isPrivate) {
        return res.status(400).json({
          error: "Your account is private, you cannot accept friend requests.",
        });
      }

      const requestIndex = userDoc.friendRequests.findIndex(
        request => request._id.toString() === requestId
      );
      if (requestIndex === -1) {
        return res.status(400).json({ error: "Friend request not found." });
      }

      const senderId = userDoc.friendRequests[requestIndex].senderId;

      // Check if already friends
      const isAlreadyFriend = userDoc.friends.some(
        friendId => friendId.toString() === senderId.toString()
      );
      if (isAlreadyFriend) {
        userDoc.friendRequests.splice(requestIndex, 1);
        await userDoc.save();
        return res.status(400).json({ error: "You are already friends with this user." });
      }

      // Add friends with duplicate checks
      if (!userDoc.friends.includes(senderId)) {
        userDoc.friends.push(senderId);
      }
      const senderDoc = await user.findById(senderId);
      if (!senderDoc.friends.includes(userId)) {
        senderDoc.friends.push(userId);
      }

      // Remove the request
      userDoc.friendRequests.splice(requestIndex, 1);

      await Promise.all([userDoc.save(), senderDoc.save()]);

      res.status(200).json({ message: "Friend request accepted." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public cancelFriendRequest = async (req, res) => {
    const { receiverId } = req.body;
    const senderId = req.authUser._id.toString();

    try {
      const receiver = await user.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: "User not found." });
      }

      const requestIndex = receiver.friendRequests.findIndex(
        request => request.senderId.toString() === senderId
      );

      if (requestIndex === -1) {
        return res.status(400).json({ error: "Friend request not found." });
      }

      receiver.friendRequests.splice(requestIndex, 1);
      await receiver.save();

      res.status(200).json({ message: "Friend request canceled successfully." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public rejectFriendRequest = async (req, res) => {
    const { requestId } = req.body;
    const userId = req.authUser._id;

    try {
      const userDoc = await user.findById(userId);
      if (!userDoc) {
        return res.status(404).json({ error: "User not found." });
      }

      const requestIndex = userDoc.friendRequests.findIndex(
        request => request._id.toString() === requestId
      );

      if (requestIndex === -1) {
        return res.status(400).json({ error: "Friend request not found." });
      }

      userDoc.friendRequests.splice(requestIndex, 1);
      await userDoc.save();

      res.status(200).json({ message: "Friend request rejected." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public getFriendRequests = async (req, res) => {
    try {
      const tempUser = await user
        .findById(req.authUser._id)
        .populate(
          "friendRequests.senderId",
          "fullname email profile_picture account_type"
        )
        .populate(
          "friendRequests.receiverId",
          "fullname email profile_picture account_type"
        );

      if (!tempUser) {
        return res.status(404).json({ error: "User not found." });
      }

      // Deduplicate friend requests
      const uniqueRequests = tempUser.friendRequests.filter(
        (request, index, self) =>
          index === self.findIndex(
            r => r.senderId._id.toString() === request.senderId._id.toString() &&
              r.receiverId._id.toString() === request.receiverId._id.toString()
          )
      );

      // Update if duplicates were found
      if (uniqueRequests.length !== tempUser.friendRequests.length) {
        tempUser.friendRequests = uniqueRequests;
        await tempUser.save();
      }

      res.status(200).json({ friendRequests: uniqueRequests });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public removeFriend = async (req, res) => {
    const { friendId } = req.body;
    const userId = req.authUser._id;

    try {
      const [userDoc, friendDoc] = await Promise.all([
        user.findById(userId),
        user.findById(friendId)
      ]);

      if (!userDoc || !friendDoc) {
        return res.status(404).json({ error: "User not found." });
      }

      // Remove friend with proper filtering
      userDoc.friends = userDoc.friends.filter(
        friend => friend.toString() !== friendId
      );
      friendDoc.friends = friendDoc.friends.filter(
        friend => friend.toString() !== userId.toString()
      );

      await Promise.all([userDoc.save(), friendDoc.save()]);

      res.status(200).json({ message: "Friend removed successfully." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public getFriends = async (req, res) => {
    try {
      const userId = req.authUser._id;
      const userDoc = await user
        .findById(userId)
        .populate("friends", "fullname email profile_picture account_type");

      if (!userDoc) {
        return res.status(404).json({ error: "User not found." });
      }

      // Deduplicate friends list
      const uniqueFriends = userDoc.friends.filter(
        (friend, index, self) =>
          index === self.findIndex(f => f._id.toString() === friend._id.toString())
      );

      // Update if duplicates were found
      if (uniqueFriends.length !== userDoc.friends.length) {
        userDoc.friends = uniqueFriends.map(f => f._id);
        await userDoc.save();
      }

      res.status(200).json({ friends: uniqueFriends });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error." });
    }
  };

  public updateIsPrivate = async (req, res) => {
    try {
      if (req["authUser"]) {
        const { isPrivate } = req.body;
        const userId = req.authUser._id;

        const result: ResponseBuilder = await this.userService.updateIsPrivate(
          userId,
          isPrivate
        );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  /**
   * Stripe User KYC
   */

  public createVerificationSessionStripeKYC = async (
    req: any,
    res: Response
  ) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.createVerificationSessionStripeKYC(
            req.authUser
          );
        return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  public getAllBooking = async (req: any, res: Response) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder = await this.userService.getAllBooking();
        return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  public getAllBookingById = async (req: any, res: Response) => {
    try {
      if (req["authUser"]) {
        const trainer_id = req["authUser"]?._id;
        const account_type = req["authUser"]?.account_type;
        const page = req?.query?.page ?? 1;
        const limit = req?.query?.limit ?? 2000;

        const result: ResponseBuilder =
          await this.userService.getAllBookingById(
            trainer_id,
            account_type,
            page,
            limit
          );

        return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  public createStripeAccountVarificationUrl = async (
    req: any,
    res: Response
  ) => {
    try {
      // if (req["authUser"]) {
      const result: ResponseBuilder =
        await this.userService.createStripeAccountVarificationUrl(req.body);
      return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      // }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  public checkIsKycCompleted = async (req: any, res: Response) => {
    try {
      if (req["authUser"]) {
        const stripe_account_id = req["authUser"].stripe_account_id;
        const result: ResponseBuilder =
          await this.userService.checkIsKycCompleted(
            req["authUser"],
            stripe_account_id
          );
        return res.status(CONSTANCE.RES_CODE.success).json({ data: result });
      }
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  };

  public updateRefundStatus = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateRefundStatus(req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public captureWriteUs = async (req, res) => {
    try {
      if (req["authUser"]) {
        const id = req["authUser"]._id;
        const result: ResponseBuilder = await this.userService.captureWriteUs(
          id,
          req.body
        );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public createRaiseConcern = async (req, res) => {
    try {
      if (req["authUser"]) {
        const id = req["authUser"]._id;
        const result: ResponseBuilder =
          await this.userService.createRaiseConcern(id, req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getCaptureWriteUs = async (req, res) => {
    try {
      if (req["authUser"]) {
        const id = req["authUser"]._id;
        const result: ResponseBuilder =
          await this.userService.getCaptureWriteUs();
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getRaiseConcern = async (req, res) => {
    try {
      if (req["authUser"]) {
        const id = req["authUser"]._id;
        const result: ResponseBuilder =
          await this.userService.getRaiseConcern();
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateWriteUsTicketStatus = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateWriteUsTicketStatus(req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateRaiseConcernTicketStatus = async (req, res) => {
    try {
      if (req["authUser"]) {
        const result: ResponseBuilder =
          await this.userService.updateRaiseConcernTicketStatus(req.body);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public getAllLatestOnlineUser = async (req, res) => {
    try {
      const result: ResponseBuilder =
        await this.userService.getAllLatestOnlineUser();
      if (result.status !== CONSTANCE.FAIL) {
        res.status(result.code).json(result);
      } else {
        res.status(result.code).json({
          status: result.status,
          error: result.error,
          code: CONSTANCE.RES_CODE.error.badRequest,
        });
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public updateTrainerStatus = async (req, res) => {
    try {
      if (req["authUser"]) {
        const { trainer_id, status } = req.body;
        const result: ResponseBuilder =
          await this.userService.updateTrainerStatus(trainer_id, status);
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };

  public deleteUser = async (req, res) => {
    try {
      if (req["authUser"]) {
        const { id } = req.params;
        const result: ResponseBuilder = await this.userService.deleteUser(
          req.authUser,
          id
        );
        if (result.status !== CONSTANCE.FAIL) {
          res.status(result.code).json(result);
        } else {
          res.status(result.code).json({
            status: result.status,
            error: result.error,
            code: CONSTANCE.RES_CODE.error.badRequest,
          });
        }
      }
    } catch (err) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.error });
    }
  };


  public approveTrainer = async (req, res) => {
    try {
      const { id } = req.params;
      const htmlResponse = await this.userService.approveTrainer(id);

      // Set content type to HTML
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlResponse);
    } catch (err) {
      const errorHtml = this.userService.getErrorHtml(
        "Server Error",
        "An unexpected error occurred. Please try again later."
      );
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(errorHtml);
    }
  };
}
