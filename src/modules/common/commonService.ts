const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');
import { extname } from "path";
import {
  allowedImageExtensions,
  CONSTANCE,
  MAX_FILE_SIZE_MB,
  Message,
  NetquixImage,
} from "../../config/constance";
import * as l10n from "jm-ez-l10n";
import { Request, Response } from "express";
import clip from "../../model/clip.schema";
import savedSession from "../../model/saved_sessions.schema";
import book from "../../model/booked_sessions.schema";

import mongoose from "mongoose";
import booked_session from "../../model/booked_sessions.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { Constant } from "../../Utils/constant";
import sharp = require("sharp");
import ReferredUser from "../../model/referred.user.schema";
import { SendEmail } from "../../Utils/sendEmail";
import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import { recordUserActivity, UserActivityEvent } from "../../helpers/userActivity";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export class commonService {
  public async uploadFile(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res
          .status(CONSTANCE.RES_CODE.error.badRequest)
          .json({ error: Message.errors.noFileUpload });
      }
      const uploadedFile = req.file;
      const fileExtension = extname(uploadedFile.originalname).toLowerCase();

      if (!allowedImageExtensions.includes(fileExtension)) {
        return res
          .status(CONSTANCE.RES_CODE.error.badRequest)
          .json({ error: Message.errors.allowedImageExtensions });
      }
      const fileSize = MAX_FILE_SIZE_MB * MAX_FILE_SIZE_MB;
      if (uploadedFile.size > fileSize) {
        return res
          .status(CONSTANCE.RES_CODE.error.badRequest)
          .json({ error: Message.errors.maxFileSizeMB });
      }

      const fileUrl = `${process.env.BASE_URL}/public/assets/${uploadedFile.filename}`;
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ success: 1, url: fileUrl });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async chatMediaUploadUrl(req: any, res: Response) {
    try {
      const userId = req?.authUser?._id;
      if (!userId) {
        return res.status(401).json({ success: 0, message: "Unauthorized" });
      }
      const { fileName, fileType } = req.body;
      if (!fileName || !fileType) {
        return res.status(400).json({ success: 0, message: "fileName and fileType are required" });
      }
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      const allowed = ["jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "m4a", "aac", "wav", "mp3", "webm"];
      if (!allowed.includes(ext)) {
        return res.status(400).json({ success: 0, message: `File type .${ext} is not allowed` });
      }
      const key = `chat-media/${userId}/${Date.now()}-${fileName}`;
      const url = await this.generatePreSignedPutUrl(key, fileType);
      if (!url) {
        return res.status(500).json({ success: 0, message: "Failed to generate upload URL" });
      }
      const publicUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      return res.status(200).json({ success: 1, uploadUrl: url, mediaUrl: publicUrl, key });
    } catch (error) {
      console.error("Error generating chat media upload URL:", error);
      return res.status(500).json({ success: 0, message: "Internal server error" });
    }
  }

  generatePreSignedPutUrl = async (fileName, fileType) => {
    const params = {
      Bucket: S3_BUCKET,
      Key: fileName,
      Expires: 600,
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

  cleanupFiles = (inputPath: string | null, tempOutputPath: string | null, finalOutputPath: string | null) => {
    try {
      if (inputPath && fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
      if (tempOutputPath && fs.existsSync(tempOutputPath)) {
        fs.unlinkSync(tempOutputPath);
      }
      if (finalOutputPath && fs.existsSync(finalOutputPath)) {
        fs.unlinkSync(finalOutputPath);
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
  }

  private async processInvites(invites: string[], referrerUser): Promise<{
    existingUserIds: string[], newUserIds: string[]
  }> {
    const existingUserIds: string[] = [];
    const newUserIds: string[] = [];


    for (const inviteEmail of invites) {
      try {
        // Check if a user with this email already exists in the User collection
        const existingUser = await user.findOne<any>({ email: inviteEmail });

        if (existingUser) {
          // If the user exists, push their ID into userIds
          existingUserIds.push(existingUser._id);


        } else {
          // Check if the email exists in the ReferredUser collection
          const existingReferredUser = await ReferredUser.findOne<any>({ email: inviteEmail });

          if (existingReferredUser) {
            // If the referred user exists, push their ID into userIds
            newUserIds.push(existingReferredUser._id);
          } else {
            // If the user doesn't exist in both collections, create a new referred user
            const referredUser = new ReferredUser({
              email: inviteEmail,
              referrerId: referrerUser._id,
            });

            // Save the referred user and push their ID into userIds
            const savedReferredUser = await referredUser.save();
            newUserIds.push(savedReferredUser._id);
          }
        }

      } catch (error) {
        console.error(`Error processing invite for ${inviteEmail}:`, error);
        // You may want to handle the error further (e.g., log it, throw it, etc.)
      }
    }

    return { existingUserIds, newUserIds };
  }


  public async videoUploadUrl(req: any, res: Response) {
    try {
      const shareWithConstants = {
        myClips: "My Clips",
        myFriends: "Friends",
        newUsers: "New Users"
      }

      // Handle bulk upload
      if (Array.isArray(req.body.clips)) {
        const results = [];
        const { shareOptions } = req.body;

        let isNewUser = false;
        let processedUserIds = [];

        // Process invites if this is a share with new users
        if (shareOptions?.type === shareWithConstants.newUsers && shareOptions?.emails) {
          const { existingUserIds, newUserIds } = await this.processInvites(shareOptions.emails, req.authUser);
          isNewUser = newUserIds.length > 0;
          processedUserIds = [...existingUserIds, ...newUserIds];
        }
        // Use selected friends if sharing with friends
        else if (shareOptions?.type === shareWithConstants.myFriends && shareOptions?.friends) {
          processedUserIds = shareOptions.friends;
        }
        // Default to current user if sharing with my clips
        else {
          processedUserIds = [req.authUser._id];
        }

        // Object to track users who need emails and their thumbnails with titles
        const usersToEmail: Record<string, { thumbnails: { url: string, title: string }[], isNewUser: boolean }> = {};

        // Enforce role-based restrictions for uploads-to-others (friends sharing flow):
        // - Trainee can upload only to trainee
        // - Trainer can upload only to trainee
        if (shareOptions?.type === shareWithConstants.myFriends) {
          const uploaderType = req?.authUser?.account_type;
          if (![AccountType.TRAINER, AccountType.TRAINEE].includes(uploaderType)) {
            return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
              success: 0,
              message: "Only trainer or trainee accounts can share clips to friends.",
            });
          }

          const targetUsers = await user.find(
            { _id: { $in: processedUserIds } },
            { _id: 1, account_type: 1 }
          );

          if (targetUsers.length !== processedUserIds.length) {
            return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
              success: 0,
              message: "One or more selected users were not found.",
            });
          }

          const hasInvalidTarget = targetUsers.some(
            (targetUser: any) => targetUser?.account_type !== AccountType.TRAINEE
          );

          if (hasInvalidTarget) {
            return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
              success: 0,
              message: "You can upload clips only to trainee accounts.",
            });
          }
        }

        // Process each clip in the bulk upload
        for (const clipData of req.body.clips) {
          const fileName = `${new Date().getTime()}_${Math.random().toString(36).substring(2, 9)}.${clipData.fileType.split("/")[1]}`;
          const thumbnailFileName = `${new Date().getTime()}_${Math.random().toString(36).substring(2, 9)}.${clipData.thumbnail.split("/")[1]}`;

          const clipPayload = {
            ...clipData,
            file_name: fileName,
            thumbnail: thumbnailFileName,
            user_id: processedUserIds
          };
          const fileUrl = await this.generatePreSignedPutUrl(fileName, clipData.fileType);
          const thumbnailURL = await this.generatePreSignedPutUrl(thumbnailFileName, clipData.thumbnail);

          // Save clips for all users
          const savedClips = [];
          for (const userId of processedUserIds) {
            const clipObj = new clip({ ...clipPayload, user_id: userId });
            await clipObj.save();
            void recordUserActivity(String(userId), UserActivityEvent.CLIP_CREATED, {
              clipId: String(clipObj._id),
              title: clipObj.title,
            });
            savedClips.push(clipObj);

            // Track users who need emails and collect their thumbnails
            if ((isNewUser && shareOptions.type === shareWithConstants.newUsers) ||
              (shareOptions.type === shareWithConstants.myFriends)) {
              if (!usersToEmail[userId]) {
                usersToEmail[userId] = {
                  thumbnails: [],
                  isNewUser: isNewUser && shareOptions.type === shareWithConstants.newUsers
                };
              }
              usersToEmail[userId].thumbnails.push({
                url: `https://data.netqwix.com/${clipObj.thumbnail}`,
                title: clipObj.title || 'Untitled Video'
              });
            }
          }

          results.push({
            success: 1,
            url: fileUrl,
            thumbnailURL,
            clips: savedClips
          });
        }

        // Send emails after all clips are processed
        for (const [userId, data] of Object.entries(usersToEmail)) {
          const userData = data.isNewUser
            ? await ReferredUser.findById(userId)
            : await user.findById(userId);

          if (userData) {
            const templateName = data.isNewUser ? "clip-shared-new-user" : "clip-shared";
            const isSingleVideo = data.thumbnails.length === 1;
        

 
            // Prepare thumbnail HTML based on count
            // Prepare thumbnail HTML based on count
            let thumbnailsHTML = '';
            let thumbnailsGridHTML = '';

            if (isSingleVideo) {
              const video = data.thumbnails[0];
              thumbnailsHTML = video.url; // Just the URL for single image
              thumbnailsGridHTML = `
                            <img src="${video.url}" alt="Video Thumbnail" style="width:100%; max-width: 200px; border: 1px solid #ddd; border-radius: 4px;"/>
                            <div style="margin-top: 5px; font-size: 14px; font-weight: bold;">${video.title}</div>
                          `;
            } else {
              // Create grid of thumbnails for multiple videos with titles
              thumbnailsGridHTML = data.thumbnails.map((video, index) => `
                               <td style="padding: 7px; vertical-align: top; width: 50%;">
                              <img src="${video.url}" alt="Video Thumbnail" style="width:100%; max-width: 200px; border: 1px solid #ddd; border-radius: 4px;"/>
                              <div style="margin-top: 5px; font-size: 14px; font-weight: bold;">${video.title}</div>
                            </td>
                              ${(index + 1) % 2 === 0 ? '</tr><tr>' : ''}
                          `).join('');
            }

            const displaySingle = data.thumbnails.length === 1 ? `
                          <div style="text-align: center; margin: 20px 0;">
                            ${thumbnailsGridHTML}
                          
                          </div>
                        ` : '';

            const displayMultiple = data.thumbnails.length > 1 ? `
                          <div style="text-align: center; margin: 20px 0;">
                            <h3 style="margin-bottom: 15px;">Shared Videos:</h3>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width: 500px; margin: 0 auto;">
  <tr>
                              ${thumbnailsGridHTML}
                             </tr>
</table>
                        ` : '';

            await SendEmail.sendRawEmail(
              templateName,
              {
                "[TRAINER/TRAINEE NAME]": req.authUser.fullname,
                "[TRAINER/TRAINEE NAME2]": req.authUser.fullname,
                "[DISPLAY_SINGLE]": displaySingle,
                "[DISPLAY_MULTIPLE]": displayMultiple,
              },
              [userData.email],
              `Your friend ${req.authUser.fullname} has shared ${data.thumbnails.length} video(s) in your NetQwix Locker!`,
            );
          }
        }

        return res.status(CONSTANCE.RES_CODE.success).json({
          success: 1,
          results,
          message: "Bulk upload processed successfully"
        });
      }

      // Handle single upload (legacy support)
      // ... (keep your existing single upload logic here)

    } catch (error) {
      console.error("Error in video upload URL:", error);
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async profileImageUrl(req: any, res: Response) {
    try {
      req.body.user_id = req?.authUser?._id;
      var fileName =
        new Date().getTime().toString() +
        "." +
        req?.body?.fileType?.split("/")[1];
      req.body.file_name = fileName;
      await user.findByIdAndUpdate(req?.authUser?._id, {
        $set: { profile_picture: fileName },
      });
      let fileUrl = await this.generatePreSignedPutUrl(
        fileName,
        req?.body?.fileType
      );
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ success: 1, url: fileUrl });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async sessionsVideoUploadUrl(req: any, res: Response) {
    try {
      req.body.user_id = req?.authUser?._id;
      var fileName =
        new Date().getTime().toString() +
        "." +
        req?.body?.fileType?.split("/")[1];
      req.body.file_name = fileName;
      const savedSessionObj = new savedSession(req.body);
      var savedSessionData = await savedSessionObj.save();
      let fileUrl = await this.generatePreSignedPutUrl(
        fileName,
        req?.body?.fileType
      );
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ success: 1, url: fileUrl });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async getAllSavedSession(req: any, res: any) {
    try {
      //NOTE -we will get data based on this user_id , when we call the api from admin for each trainer and trainee
      const id = req?.body?.user_id || req?.authUser?._id;
      // check if user is trainer or trainee
      const query = {
        $and: [
          {
            $or: [{ status: true }, { status: { $exists: false } }],
          },
          {
            $or: [{ trainer: id }, { trainee: id }],
          },
        ],
      };

      const data = await savedSession.find(query);

      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ success: 1, data: data });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async pdfUploadUrl(req: any, res: Response) {
    try {
      var filename = "file-" + new Date().getTime().toString() + ".pdf";
      req.body.user_id = req?.authUser?._id;
      const clipObj = await booked_session.findOneAndUpdate(
        { _id: req.body.session_id },
        { report: filename }
      );
      let fileUrl = await this.generatePreSignedPutUrl(
        filename,
        "application/pdf"
      );
      return res
        .status(CONSTANCE.RES_CODE.success)
        .json({ success: 1, url: fileUrl });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async getClips(req: any, res: Response) {
    try {
      const trainee_id = req.body.trainee_id ?? null;

      var clips = await clip.aggregate([
        {
          $match: {
            user_id: {
              $in: [new mongoose.Types.ObjectId(trainee_id ?? req?.authUser?._id)]
            },
            $or: [{ status: true }, { status: { $exists: false } }],
          },
        },
        {
          $group: {
            _id: "$category",
            clips: {
              $push: "$$ROOT",
            },
          },
        },
      ]);

      return res.status(CONSTANCE.RES_CODE.success).json({ data: clips });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async traineeClips(req: any, res: Response) {
    try {
      var clips = await book.aggregate([
        {
          $match: {
            trainer_id: new mongoose.Types.ObjectId(req?.authUser?._id),
          },
        },
        {
          $lookup: {
            from: "clips",
            localField: "trainee_clip",
            foreignField: "_id",
            as: "clips",
          },
        },
        {
          $unwind: {
            path: "$clips",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "clips.user_id",
            foreignField: "_id",
            as: "clip_user",
            pipeline: [
              {
                $project: Constant.pipelineUser,
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$clip_user",
          },
        },
        {
          $group: {
            _id: "$clip_user",
            clips: {
              $push: "$$ROOT",
            },
          },
        },
      ]);
      return res.status(CONSTANCE.RES_CODE.success).json({ data: clips });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async deleteClip(req: any, res: Response) {
    try {
      const { id } = req?.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
          success: 0,
          message: "Invalid ID",
        });
      }
      var clips = await clip.findByIdAndUpdate(id, { $set: { status: false } });
      if (!clips) {
        return res.status(CONSTANCE.RES_CODE.error.notFound).json({
          success: 0,
          message: Message.notFoundData,
        });
      }
      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        message: "Clip deleted Successfully",
      });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async deleteSavedSession(req: any, res: Response) {
    try {
      const { id } = req?.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
          success: 0,
          message: "Invalid ID",
        });
      }
      var session = await savedSession.findByIdAndUpdate(id, {
        $set: { status: false },
      });
      if (!session) {
        return res.status(CONSTANCE.RES_CODE.error.notFound).json({
          success: 0,
          message: Message.notFoundData,
        });
      }
      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        message: "Saved Session deleted Successfully",
      });
    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }
  }

  public async generateThumbnail(req: any, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: 0, message: 'No video file uploaded.' });
      }

      const inputPath = req.file.path;
      const thumbnailDir = path.join(__dirname, '..', 'thumbnails'); // Adjust this path as needed
      const outputPath = path.join(thumbnailDir, `${req.file.filename}.jpg`);

      // Ensure the thumbnail directory exists
      if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
      }

      return new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .screenshots({
            timestamps: ['00:00:01'],
            filename: `${req.file.filename}.jpg`,
            folder: thumbnailDir,
            size: "700x1100",
          })
          .on('end', () => {
            fs.unlinkSync(inputPath); // Remove the uploaded video file

            // Check if the thumbnail file exists
            if (!fs.existsSync(outputPath)) {
              reject(new Error('Thumbnail file not created'));
              return;
            }

            // Send the thumbnail file
            res.sendFile(outputPath, (err) => {
              if (err) {
                console.error('Error sending file:', err);
                reject(err);
              } else {
                // Remove the thumbnail file after sending
                fs.unlinkSync(outputPath);
                resolve();
              }
            });
          })
          .on('error', (err) => {
            console.error('Error generating thumbnail:', err);
            reject(err);
          });
      });

    } catch (error) {
      res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
      });
    }

    // let inputPath: string | null = null;
    // let tempOutputPath: string | null = null;
    // let finalOutputPath: string | null = null;

    // try {
    //   if (!req.file) {
    //     return res.status(400).json({ success: 0, message: 'No video file uploaded.' });
    //   }

    //   inputPath = req.file.path;
    //   const thumbnailDir = path.join(__dirname, '..', 'thumbnails'); // Adjust this path as needed
    //   tempOutputPath = path.join(thumbnailDir, `${req.file.filename}_temp.jpg`);
    //   finalOutputPath = path.join(thumbnailDir, `${req.file.filename}.jpg`);

    //   // Ensure the thumbnail directory exists
    //   if (!fs.existsSync(thumbnailDir)) {
    //     fs.mkdirSync(thumbnailDir, { recursive: true });
    //   }

    //   await new Promise<void>((resolve, reject) => {
    //     ffmpeg(inputPath!)
    //       .inputOptions(['-ss 00:00:01'])
    //       .outputOptions(['-frames:v 1'])
    //       .output(tempOutputPath!)
    //       .on('end', async () => {
    //         try {
    //           // Resize the image using sharp
    //           await sharp(tempOutputPath!)
    //             .resize(320, 240, { fit: 'cover' })
    //             .toFile(finalOutputPath!);

    //           // Send the final thumbnail file
    //           res.sendFile(finalOutputPath!, (err) => {
    //             if (err) {
    //               console.error('Error sending file:', err);
    //               reject(err);
    //             } else {
    //               setTimeout(() => {
    //                 this.cleanupFiles(inputPath, tempOutputPath, finalOutputPath);
    //               }, 5 * 60 * 1000);
    //               resolve();
    //             }
    //           });
    //         } catch (err) {
    //           console.error('Error processing with sharp:', err);
    //           reject(err);
    //         }
    //       })
    //       .on('error', (err) => {
    //         console.error('Error generating thumbnail with ffmpeg:', err);
    //         reject(err);
    //       })
    //       .run();
    //   });

    // } catch (error) {
    //   console.error('Thumbnail generation error:', error);
    //   this.cleanupFiles(inputPath, tempOutputPath, finalOutputPath);
    //   res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
    //     success: 0,
    //     message: Message.internal,
    //   });
    // } finally {

    //   // Clean up files in the finally block

    //   this.cleanupFiles(inputPath, tempOutputPath, finalOutputPath);
    //   // try {
    //   //   if (inputPath && fs.existsSync(inputPath)) {
    //   //     fs.unlinkSync(inputPath);
    //   //   }
    //   //   if (tempOutputPath && fs.existsSync(tempOutputPath)) {
    //   //     fs.unlinkSync(tempOutputPath);
    //   //   }
    //   //   if (finalOutputPath && fs.existsSync(finalOutputPath)) {
    //   //     fs.unlinkSync(finalOutputPath);
    //   //   }
    //   // } catch (cleanupError) {
    //   //   console.error('Error during cleanup:', cleanupError);
    //   // }
    // }
  }

  public async featuredContentUploadUrl(req: any, res: Response) {
    try {
      if (!req.body.user_id) {
        req.body.user_id = [req?.authUser?._id];
      }
      if (req.body.invites && Array.isArray(req.body.invites)) {
        const { existingUserIds, newUserIds } = await this.processInvites(req.body.invites, req.authUser);
        req.body.user_id = [...req.body.user_id, ...existingUserIds, ...newUserIds];
      }

      if (!req?.body?.fileType || !req?.body?.thumbnail) {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
          success: 0,
          message: "fileType and thumbnail are required.",
        });
      }
      const timestamp = new Date().getTime().toString();
      const fileType = req?.body?.fileType?.split("/")[1];
      const thumbnailType = req?.body?.thumbnail?.split("/")[1];

      if (!fileType || !thumbnailType) {
        return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
          success: 0,
          message: "Invalid fileType or thumbnail format.",
        });
      }

      const fileName = `${timestamp}.${fileType}`;
      const thumbnailFileName = `${timestamp}.${thumbnailType}`;

      req.body.file_name = fileName;
      req.body.thumbnail = thumbnailFileName;

      const fileUrl = await this.generatePreSignedPutUrl(fileName, req.body.fileType);
      const thumbnailURL = await this.generatePreSignedPutUrl(thumbnailFileName, req.body.thumbnail);

      if (!fileUrl || !thumbnailURL) {
        return res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
          success: 0,
          message: "Failed to generate pre-signed URLs.",
        });
      }

      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        url: fileUrl,
        thumbnailURL,
      });

    } catch (error) {
      console.error("Error in featuredContentUploadUrl:", error);
      return res.status(CONSTANCE.RES_CODE.error.internalServerError).json({
        success: 0,
        message: Message.internal,
        error: error.message
      });
    }
  }

}
