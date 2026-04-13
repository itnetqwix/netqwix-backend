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
const bucketName = process.env.AWS_BUCKET_NAME;
const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
import * as AWS from "aws-sdk";
import mongoose from "mongoose";
import { Constant } from "../../Utils/constant";
const s3 = new AWS.S3({
  endpoint: `https://${process.env.CLOUDFLARE_R2}.r2.cloudflarestorage.com`,
  region,
  accessKeyId,
  secretAccessKey,
  signatureVersion: "v4",
});

export class ReportService {
  public log = log.getLogger();
  public commonService = new commonService();

  public async createReport(data: any): Promise<ResponseBuilder> {
    const report = await Report.updateOne(
      {
        sessions: data?.sessions,
        trainee: data?.trainee,
        trainer: data?.trainer,
      },
      {
        title: data?.title,
        description: data?.topic,
        reportData: data?.reportData,
      }
    );

    if (report) {
      return ResponseBuilder.data(report, l10n.t("REPORT_GENERATED"));
    } else {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  generatePreSignedPutUrl = async (fileName, fileType) => {
    const params = {
      Bucket: bucketName,
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
    let fileUrl = await this.generatePreSignedPutUrl(filename, "png");
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
      let fileUrl = await this.generatePreSignedPutUrl(filename, "png");
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
    } else {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
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
                $project: Constant.pipelineUser,
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
                $project: Constant.pipelineUser,
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
          },
        },
        {
          $unwind: {
            path: "$session",
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
