import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import { log } from "../../../logger";
import Report from "../../model/report.schema";
import { CONSTANCE, Message } from "../../config/constance";
import {
  getSearchRegexQuery,
  isValidMongoObjectId,
} from "../../helpers/mongoose";
import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { Utils } from "../../Utils/Utils";
import { commonService } from "../common/commonService";
import * as AWS from "aws-sdk";
import mongoose from "mongoose";
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import { publishSocketEventToSession } from "../../services/eventPubSub";
import { EVENTS } from "../../config/constance";
import booked_session from "../../model/booked_sessions.schema";

export class ReportService {
  public log = log.getLogger();
  public commonService = new commonService();

  public async createReport(data: any): Promise<ResponseBuilder> {
    const filter = {
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    };
    const hadReport = await Report.findOne(filter).select("_id updatedAt").lean();
    const report = await Report.updateOne(filter, {
      title: data?.title,
      description: data?.topic,
      reportData: data?.reportData,
    });

    if (report) {
      const traineeId = data?.trainee ? String(data.trainee) : "";
      const trainerId = data?.trainer ? String(data.trainer) : "";
      const sessionId = data?.sessions ? String(data.sessions) : "";
      const title = data?.title ? String(data.title).trim() : "Session game plan";
      const kind = hadReport ? "game_plan_updated" : "game_plan_saved";
      let reportPdfKey: string | null = null;
      if (sessionId && mongoose.isValidObjectId(sessionId)) {
        try {
          const booking = await booked_session
            .findById(sessionId)
            .select("report")
            .lean();
          reportPdfKey = (booking as any)?.report
            ? String((booking as any).report)
            : null;
        } catch {
          /* ignore */
        }
        void publishSocketEventToSession(sessionId, EVENTS.GAME_PLAN_SHARED, {
          sessionId,
          title,
          trainerId,
          traineeId,
          reportPdfKey,
          kind,
          updatedAt: new Date().toISOString(),
        });
      }
      if (traineeId && mongoose.isValidObjectId(traineeId)) {
        try {
          const { NotificationsService } = require("../notifications/notificationsService");
          const push = new NotificationsService();
          const pushTitle =
            kind === "game_plan_updated" ? "Game plan updated" : "New session plan";
          const pushBody =
            kind === "game_plan_updated"
              ? `${title} was updated by your coach.`
              : `${title} is ready in your locker.`;
          void push.sendPushNotification(traineeId, pushTitle, pushBody, {
            category: "game_plan",
            sessionId,
            trainerId,
            kind,
          });
        } catch (notifyErr) {
          console.warn("[createReport] trainee push skipped", notifyErr);
        }
      }
      return ResponseBuilder.data(report, l10n.t("REPORT_GENERATED"));
    } else {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  generatePreSignedPutUrl = async (fileName, fileType) => {
    const params = {
      Bucket: S3_BUCKET,
      Key: fileName,
      Expires: 60,
      // ACL: "public-read",
      ContentType: fileType,
    };

    let url;
    try {
      url = await s3.getSignedUrlPromise("putObject", params);
    } catch (err) {
      console.error("Error generating pre-signed URL:", err);
      // do something with the error here
      // and abort the operation.
      return;
    }
    return url;
  };

  public async addSessionRecording(data: any): Promise<ResponseBuilder> {
    const filename = "session-rec-" + new Date().getTime().toString() + ".webm";
    const isReportExist = await Report.findOne({
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    });
    if (isReportExist) {
      await Report.updateOne(
        {
          sessions: data?.sessions,
          trainee: data?.trainee,
          trainer: data?.trainer,
        },
        { $set: { sessionRecordingUrl: filename } }
      );
    } else {
      const obj = {
        title: data?.title || "",
        description: data?.description || "",
        reportData: [],
        sessions: data?.sessions,
        trainer: data?.trainer,
        trainee: data?.trainee,
        sessionRecordingUrl: filename,
      };
      await new Report(obj).save();
    }
    const fileUrl = await this.generatePreSignedPutUrl(filename, "video/webm");
    if (fileUrl) {
      return ResponseBuilder.data({ url: fileUrl }, l10n.t("REPORT_GENERATED"));
    }
    return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
  }

  public async addImage(data: any): Promise<ResponseBuilder> {
    var filename = "file-" + new Date().getTime().toString() + ".png";
    const isReportExist = await Report.findOne({
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    });
    if (isReportExist) {
      const result = await Report.updateOne(
        {
          sessions: data?.sessions,
          trainee: data?.trainee,
          trainer: data?.trainer,
        },
        {
          $push: {
            reportData: {
              title: "",
              description: "",
              imageUrl: filename,
            },
          },
        }
      );
    } else {
      var obj = {
        title: data?.title,
        description: data?.description,
        reportData: [
          {
            title: "",
            description: "",
            imageUrl: filename,
          },
        ],
        sessions: data?.sessions,
        trainer: data?.trainer,
        trainee: data?.trainee,
      };
      const report = new Report(obj).save();
    }
    let fileUrl = await this.generatePreSignedPutUrl(filename, "image/png");
    if (fileUrl) {
      return ResponseBuilder.data({ url: fileUrl }, l10n.t("REPORT_GENERATED"));
    } else {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async cropImage(data: any): Promise<ResponseBuilder> {
    var filename = "file-" + new Date().getTime().toString() + ".png";
    const isReportExist = await Report.findOne({
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    });
    if (isReportExist) {
      var newReportData = isReportExist.reportData;
      newReportData = newReportData.map((obj: any) => {
        if (obj.imageUrl === data.oldFile) {
          return { ...obj, imageUrl: filename };
        }
        return obj;
      });
      const result = await Report.updateOne(
        {
          sessions: data?.sessions,
          trainee: data?.trainee,
          trainer: data?.trainer,
        },
        { reportData: newReportData }
      );
      let fileUrl = await this.generatePreSignedPutUrl(filename, "image/png");
      if (fileUrl) {
        return ResponseBuilder.data(
          { url: fileUrl },
          l10n.t("REPORT_GENERATED")
        );
      } else {
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
      }
    }
  }

  public async removeImage(data: any): Promise<ResponseBuilder> {
    const isReportExist = await Report.findOne({
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    });
    if (isReportExist) {
      var newReportData = isReportExist.reportData;
      newReportData = newReportData.filter((r) => r.imageUrl !== data.filename);
      const result = await Report.updateOne(
        {
          sessions: data?.sessions,
          trainee: data?.trainee,
          trainer: data?.trainer,
        },
        { reportData: newReportData }
      );
      return ResponseBuilder.successMessage("Success");
    }
  }

  public async getReport(data: any): Promise<ResponseBuilder> {
    const report = await Report.findOne({
      sessions: data?.sessions,
      trainee: data?.trainee,
      trainer: data?.trainer,
    });
    if (report) {
      // Add flag to indicate logos should not be added to individual images in PDF
      // Logo should only appear at the top right of the PDF, not on each image
      const reportData = report.toObject ? report.toObject() : report;
      reportData.addLogoToImages = false;
      return ResponseBuilder.data(reportData, l10n.t("REPORT_GET"));
    }
    // No row yet (common at session start / instant lesson) — same shape as a real report, 200 OK
    return ResponseBuilder.data(
      {
        reportData: [],
        sessions: data?.sessions,
        trainee: data?.trainee,
        trainer: data?.trainer,
        addLogoToImages: false,
      },
      l10n.t("REPORT_GET")
    );
  }

  // public async getAllReport(data: any): Promise<ResponseBuilder> {
  //   // const report = await Report.find(data)
  //   const report = await Report.aggregate([
  //     {
  //       '$match': {
  //         '$or': [
  //           {
  //             'trainee': new mongoose.Types.ObjectId(data?._id)
  //           }, {
  //             'trainer': new mongoose.Types.ObjectId(data?._id)
  //           }
  //         ]
  //       }
  //     },
  //     {
  //       '$lookup': {
  //         'from': 'users',
  //         'localField': 'trainee',
  //         'foreignField': '_id',
  //         'as': 'trainee'
  //       }
  //     },
  //     {
  //       '$unwind': {
  //         'path': '$trainee'
  //       }
  //     },
  //     {
  //       '$lookup': {
  //         'from': 'users',
  //         'localField': 'trainer',
  //         'foreignField': '_id',
  //         'as': 'trainer'
  //       }
  //     },
  //     {
  //       '$unwind': {
  //         'path': '$trainer'
  //       }
  //     },
  //     {
  //       '$lookup': {
  //         'from': 'booked_sessions',
  //         'localField': 'sessions',
  //         'foreignField': '_id',
  //         'as': 'session'
  //       }
  //     },
  //     {
  //       '$unwind': {
  //         'path': '$session'
  //       }
  //     },
  //     {
  //       '$group': {
  //         '_id': {
  //           'year': {
  //             '$year': '$createdAt'
  //           },
  //           'month': {
  //             '$month': '$createdAt'
  //           },
  //           'day': {
  //             '$dayOfMonth': '$createdAt'
  //           }
  //         },
  //         'report': {
  //           '$push': '$$ROOT'
  //         },
  //       }
  //     },
  //     {
  //       "$sort": {
  //         "_id": -1
  //       }
  //     },
  //   ])

  //   if (report?.length) {
  //     return ResponseBuilder.data(report, l10n.t("REPORT_GET"));
  //   } else {
  //     return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
  //   }
  // }

  public async getAllReport(data: any): Promise<ResponseBuilder> {
    try {
      //NOTE -we will get data based on this user_id , when we call the api from admin for each trainer and trainee
      const id = data?.user_id || data?._id;
      const traineeIsNotAvailableMatchQuery = {
        $or: [
          {
            trainee: new mongoose.Types.ObjectId(id),
          },
          {
            trainer: new mongoose.Types.ObjectId(id),
          },
        ],
      };

      const traineeIsvailableMatchQuery = {
        trainer: new mongoose.Types.ObjectId(data._id),
        trainee: new mongoose.Types.ObjectId(data.trainee_id),
      };
      const report = await Report.aggregate([
        {
          $match: {
            $and: [
              data.trainee_id
                ? traineeIsvailableMatchQuery
                : traineeIsNotAvailableMatchQuery,
              {
                $or: [{ status: true }, { status: { $exists: false } }],
              },
            ],
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trainee",
            foreignField: "_id",
            as: "trainee",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  fullname: 1,
                  profile_picture: 1,
                  account_type: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$trainee",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trainer",
            foreignField: "_id",
            as: "trainer",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  fullname: 1,
                  profile_picture: 1,
                  account_type: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$trainer",
          },
        },
        {
          $lookup: {
            from: "booked_sessions",
            localField: "sessions",
            foreignField: "_id",
            as: "session",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  report: 1,
                  status: 1,
                  booked_date: 1,
                  session_start_time: 1,
                  session_end_time: 1,
                  start_time: 1,
                  end_time: 1,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$session",
          },
        },
        {
          // Keep payload minimal for Locker/Game Plan consumers.
          $project: {
            _id: 1,
            reportData: 1,
            sessions: 1,
            sessionRecordingUrl: 1,
            trainer: 1,
            trainee: 1,
            session: 1,
            title: 1,
            description: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        {
          $group: {
            _id: {
              year: {
                $year: "$createdAt",
              },
              month: {
                $month: "$createdAt",
              },
              day: {
                $dayOfMonth: "$createdAt",
              },
            },
            report: {
              $push: "$$ROOT",
            },
          },
        },
        {
          $sort: {
            _id: -1,
          },
        },
      ]);

      if (report?.length) {
        // Add flag to indicate logos should not be added to individual images in PDF
        // Logo should only appear at the top right of the PDF, not on each image
        const reportWithFlag = report.map((r: any) => {
          const reportItem = { ...r };
          reportItem.addLogoToImages = false;
          return reportItem;
        });
        return ResponseBuilder.data(reportWithFlag, l10n.t("REPORT_GET"));
      } else {
        return ResponseBuilder.data([], l10n.t("REPORT_NOT_FOUND"));
      }
    } catch (error) {
      console.error("Error in getAllReport.ts", error);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async deleteReport(id: string): Promise<ResponseBuilder> {
    try {
      if (!mongoose.isValidObjectId(id)) {
        return ResponseBuilder.badRequest(l10n.t("Invalid ID"));
      }
      var report = await Report.findByIdAndUpdate(id, {
        $set: { status: false },
      });
      if (!report) {
        return ResponseBuilder.badRequest(l10n.t(Message.notFoundData));
      }
      return ResponseBuilder.successMessage("Report Deleted successfully");
    } catch (error) {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
}
