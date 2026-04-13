import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import { log } from "../../../logger";
import schedule_inventory from "../../model/schedule_inventory.schema";
import {
  updateProfileModal,
  updateSlotsModel,
} from "./trainerValidator/updateSlotsValidator";
import { CONSTANCE } from "../../config/constance";
import {
  getSearchRegexQuery,
  isValidMongoObjectId,
} from "../../helpers/mongoose";
import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { Utils } from "../../Utils/Utils";
import availability from "../../model/availability.schema";
import mongoose, { PipelineStage } from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import trainer_money_request from "./money_withdraw.schema";
import { Constant } from "../../Utils/constant";

export class TrainerService {
  public log = log.getLogger();

  public async updateSchedulingSlots(
    schedulingSlots: updateSlotsModel,
    user_id: string
  ): Promise<ResponseBuilder> {
    this.log.info(schedulingSlots);
    let trainerSlots = await schedule_inventory.findOne({
      trainer_id: user_id,
    });

    if (trainerSlots) {
      await schedule_inventory.updateOne(
        { trainer_id: user_id },
        schedulingSlots
      );
      return ResponseBuilder.data(
        schedulingSlots,
        l10n.t("SCHEDULE_SLOTS_UPDATED")
      );
    } else {
      const schedulingSlotsObj = new schedule_inventory({
        ...schedulingSlots,
        trainer_id: user_id,
      });
      await schedulingSlotsObj.save();
      return ResponseBuilder.data(
        schedulingSlots,
        l10n.t("SCHEDULE_SLOTS_UPDATED")
      );
    }
  }

  public async addStot(data: any): Promise<ResponseBuilder> {
    const slotObj = new availability(data);
    var newSlotObj = await slotObj.save();
    return ResponseBuilder.data(
      newSlotObj,
      "Slot Added Successfully."
    );
  }


  public async updateStot(data: any): Promise<ResponseBuilder> {
    const updatedSlot = await availability.updateOne({ _id: data?._id }, data);
    return ResponseBuilder.data(
      updatedSlot,
      "Slot Updated Successfully."
    );
  }


  public async updateManyStot(filter: any, data: any): Promise<ResponseBuilder> {
    const updatedSlot = await availability.updateMany(filter, data);
    return ResponseBuilder.data(
      updatedSlot,
      "Slot Updated Successfully."
    );
  }


  public async deleteStot(data: any): Promise<ResponseBuilder> {
    const updatedSlot = await availability.deleteOne({ _id: data?._id });
    return ResponseBuilder.data(
      updatedSlot,
      "Slot Deleted Successfully."
    );
  }


  public async getAvailability(data: any): Promise<ResponseBuilder> {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    var start_time = data?.start_time ? data?.start_time : firstDayOfMonth;
    var end_time = data?.end_time ? data?.end_time : lastDayOfMonth;

    var availabilities = await availability.aggregate([
      {
        '$match': {
          '$and': [
            {
              'start_time': {
                '$gte': new Date(start_time)
              }
            }, {
              'end_time': {
                '$lte': new Date(end_time)
              }
            },
            { "trainer_id": data?.trainer_id }
          ]
        }
      },
      // {
      //   '$group': {
      //     '_id': {
      //       '$dateToString': {
      //         'format': '%Y-%m-%d',
      //         'date': '$start_time',
      //       }
      //     },
      //     'availabilities': {
      //       '$push': '$$ROOT'
      //     }
      //   }
      // },
      {
        "$sort": {
          "start_time": 1
        }
      }
    ]

    );
    return ResponseBuilder.data(
      availabilities,
      "Availabilities find Successfully."
    );
  }

  public async getSchedulingSlots(
    trainer_id: string
  ): Promise<ResponseBuilder> {
    this.log.info(trainer_id);
    const schedulingSlots = await schedule_inventory.findOne({ trainer_id });

    if (schedulingSlots) {
      return ResponseBuilder.data(
        schedulingSlots,
        l10n.t("SCHEDULE_SLOTS_FETCHED")
      );
    } else {
      return ResponseBuilder.data(
        CONSTANCE.SCHEDULING_SLOTS,
        l10n.t("SCHEDULE_SLOTS_FETCHED")
      );
    }
  }

  public async getTrainers(query): Promise<ResponseBuilder> {
    try {
      const result = await user.aggregate([
        {
          $match: {
            $and: [{ account_type: AccountType.TRAINER }],
          },
        },
        {
          $project: {
            id: "$_id",
            fullname: 1,
            email: 1,
            profile_picture: 1,
            category: 1,
            extraInfo: 1,
            status:1,
          },
        },
      ]);
      return ResponseBuilder.data(result, l10n.t("NO_TRAINERS_FOUND"));
    } catch (error) {
      console.error("Error getting trainers:", error);
      return ResponseBuilder.errorMessage("Internal server error");
    }
  }

  public async recentTrainees(authUser): Promise<ResponseBuilder> {
    try {
      const pipeline = [
        {
          '$match': {
            'trainer_id': new mongoose.Types.ObjectId(authUser?._id)
          }
        }, {
          '$group': {
            '_id': '$trainee_id'
          }
        }, {
          '$lookup': {
            'from': 'users',
            'localField': '_id',
            'foreignField': '_id',
            'as': 'trainee',
            'pipeline': [
              {
                '$project': Constant.pipelineUser,
              }
            ],
          }
        }, {
          '$unwind': {
            'path': '$trainee'
          }
        }, {
          '$replaceRoot': {
            'newRoot': '$trainee'
          }
        }
      ]
      const result = await booked_session.aggregate(pipeline);
      return ResponseBuilder.data(result, l10n.t("NO_TRAINERS_FOUND"));
    } catch (error) {
      console.error("Error getting recent trainees:", error);
      return ResponseBuilder.errorMessage("Internal server error");
    }
  }

  public async traineeClips(data): Promise<ResponseBuilder> {
    try {
      const result = await clip.find({ 'user_id': data?.trainer_id }).sort({ createdAt: 1 });
      return ResponseBuilder.data(result, l10n.t("NO_TRAINERS_FOUND"));
    } catch (error) {
      return ResponseBuilder.errorMessage("Internal server error");
    }
  }

  public async updateProfile(reqBody, authUser): Promise<ResponseBuilder> {
    
    try {
      await user.findOneAndUpdate(
        { _id: authUser["_id"].toString() },
        { $set: { ...reqBody } },
        { new: true }
      );
      return ResponseBuilder.data({}, l10n.t("PROFILE_UPDATED"));
    } catch (err) {
      console.error("Error updating profile:", err);
      throw err;
    }
  }

  public async createMoneyRequest(userInfo: any, body: any) {
    try {
      const { _id } = userInfo;

      const getUser = await user.findById(_id);

      const wallet_amount = getUser.wallet_amount;

      const { requested_amount } = body;

      if (!requested_amount) {
        return ResponseBuilder.data([], "requested amount can't be empty");
      }

      if (Number(requested_amount) > Number(wallet_amount)) {
        return ResponseBuilder.data([], "You can't request gretter then wallet amount");
      }

      const create_money_request = new trainer_money_request({ requested_amount, wallet_amount, trainer: _id });
      create_money_request.save()

      if (!create_money_request) {
        return ResponseBuilder.data([], "Money Request canceled");
      }

      return ResponseBuilder.data(create_money_request, "Money Request created successfully!");
    }
    catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAllMoneyRequest() {
    try {
      const pipeline: PipelineStage[] = [
        {
          $lookup: {
            from: "users",
            localField: "trainer",
            foreignField: "_id",
            as: "trainee_info"
          }
        },
        {
          $addFields: {
            "trainee_info": {
              $arrayElemAt: ["$trainee_info", 0]
            }
          }
        },
        {
          $project: {
            _id: 1,
            wallet_amount: 1,
            requested_amount: 1,
            payment_status: 1,
            trainer: 1,
            createdAt: 1,
            updatedAt: 1,
            "trainee_info.fullName": "$trainee_info.fullname",
            "trainee_info.email": "$trainee_info.email",
            "trainee_info.profilePicture": "$trainee_info.profile_picture",
          }
        },
        {
          $sort: {
            updatedAt: -1 // Sort by updatedAt field in descending order
          }
        }
      ];
       const money_request = await trainer_money_request.aggregate(pipeline);
      if (!money_request) {
        return ResponseBuilder.data([], "Money Request not found");
      }

      return ResponseBuilder.data(money_request, "Money Request Fetched successfully");
    }
    catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async recentTrainers(authUser): Promise<ResponseBuilder> {
    try {
      const pipeline = [
        {
          '$match': {
            'trainee_id': new mongoose.Types.ObjectId(authUser)
          }
        }, 
        {
          '$group': {
            '_id': '$trainer_id'
          }
        }, 
        {
          '$lookup': {
            'from': 'users',
            'localField': '_id',
            'foreignField': '_id',
            'as': 'trainer',
            'pipeline': [
              {
                '$project': Constant.pipelineUser,
              }
            ],
          }
        }, 
        {
          '$unwind': {
            'path': '$trainer'
          }
        }, 
        {
          '$replaceRoot': {
            'newRoot': '$trainer'
          }
        }
      ]
      const result = await booked_session.aggregate(pipeline);
      return ResponseBuilder.data(result, l10n.t("NO_TRAINERS_FOUND"));
    } catch (error) {
      console.error("Error getting recent trainers:", error);
      return ResponseBuilder.errorMessage("Internal server error");
    }
  }
}
