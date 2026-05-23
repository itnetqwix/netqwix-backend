import { Response } from "express";
import mongoose from "mongoose";
import { CONSTANCE } from "../../config/constance";
import { MAX_CLIP_FILE_BYTES } from "../../config/storageLimits";
import clip from "../../model/clip.schema";
import user from "../../model/user.schema";
import ReferredUser from "../../model/referred.user.schema";
import { AccountType } from "../auth/authEnum";
import { SendEmail } from "../../Utils/sendEmail";
import { recordUserActivity, UserActivityEvent } from "../../helpers/userActivity";
import { storageService } from "./storageService";
import { clipTaxonomyService } from "../clips/clipTaxonomyService";

const SHARE_MY_CLIPS = "My Clips";
const SHARE_FRIENDS = "Friends";
const SHARE_NEW_USERS = "New Users";

export type ClipConfirmBody = {
  videoKey: string;
  thumbnailKey: string;
  fileType: string;
  title: string;
  category?: string;
  category_id?: string;
  subcategory_id?: string;
  fileSizeBytes: number;
  shareOptions?: {
    type?: string;
    friends?: string[];
    emails?: string[];
  };
};

function keyOwnedByUser(key: string, userId: string, prefix: "clips" | "thumbnails"): boolean {
  const expected = `${prefix}/${userId}/`;
  return typeof key === "string" && key.startsWith(expected);
}

async function resolveShareUserIds(
  authUser: any,
  shareOptions?: ClipConfirmBody["shareOptions"]
): Promise<
  | { ok: true; userIds: string[]; sharingWithFriends: boolean; isNewUser: boolean }
  | { ok: false; status: number; message: string }
> {
  const sharerId = String(authUser._id);
  const type = shareOptions?.type ?? SHARE_MY_CLIPS;

  if (type === SHARE_NEW_USERS && shareOptions?.emails?.length) {
    const existingUserIds: string[] = [];
    const newUserIds: string[] = [];
    for (const inviteEmail of shareOptions.emails) {
      const existingUser = await user.findOne({ email: inviteEmail }).select("_id").lean();
      if (existingUser) {
        existingUserIds.push(String(existingUser._id));
      } else {
        const existingReferred = await ReferredUser.findOne({ email: inviteEmail }).lean();
        if (existingReferred) {
          newUserIds.push(String(existingReferred._id));
        } else {
          const referredUser = new ReferredUser({
            email: inviteEmail,
            referrerId: authUser._id,
          });
          const saved = await referredUser.save();
          newUserIds.push(String(saved._id));
        }
      }
    }
    return {
      ok: true,
      userIds: [...existingUserIds, ...newUserIds],
      sharingWithFriends: false,
      isNewUser: newUserIds.length > 0,
    };
  }

  if (type === SHARE_FRIENDS) {
    let friendIds: string[] = [];
    if (shareOptions?.friends?.length) {
      friendIds = shareOptions.friends.map(String);
    } else if (shareOptions?.emails?.length) {
      const found = await user
        .find({ email: { $in: shareOptions.emails } })
        .select("_id email")
        .lean();
      friendIds = found.map((u: any) => String(u._id));
      if (friendIds.length !== shareOptions.emails.length) {
        return {
          ok: false,
          status: 400,
          message: "One or more friends must be registered NetQwix users.",
        };
      }
    } else {
      return { ok: false, status: 400, message: "Select at least one friend to share with." };
    }

    const uploaderType = authUser?.account_type;
    if (![AccountType.TRAINER, AccountType.TRAINEE].includes(uploaderType)) {
      return {
        ok: false,
        status: 400,
        message: "Only trainer or trainee accounts can share clips to friends.",
      };
    }
    const uploaderDoc: any = await user.findById(sharerId).select("friends").lean();
    const friendSet = new Set((uploaderDoc?.friends ?? []).map((id: any) => String(id)));
    const notFriends = friendIds.filter((id) => !friendSet.has(id));
    if (notFriends.length) {
      return {
        ok: false,
        status: 400,
        message: "You can only share clips with friends on your friends list.",
      };
    }
    return { ok: true, userIds: friendIds, sharingWithFriends: true, isNewUser: false };
  }

  return { ok: true, userIds: [sharerId], sharingWithFriends: false, isNewUser: false };
}

export class ClipConfirmService {
  async confirmHandler(req: any, res: Response) {
    try {
      const authUser = req.authUser;
      const userId = String(authUser?._id || "");
      if (!userId) {
        return res.status(401).json({ success: 0, message: "Unauthorized" });
      }

      const body = req.body as ClipConfirmBody;
      const videoKey = String(body.videoKey || "").trim();
      const thumbnailKey = String(body.thumbnailKey || "").trim();
      const fileSizeBytes = Number(body.fileSizeBytes || 0);
      const title = String(body.title || "").trim();
      const fileType = String(body.fileType || "video/mp4").trim();

      let category = String(body.category || "").trim();
      let categoryId: any = null;
      let subcategoryId: any = null;

      if (body.category_id && body.subcategory_id) {
        try {
          const resolved = await clipTaxonomyService.resolveCategoryIds(
            body.category_id,
            body.subcategory_id
          );
          categoryId = resolved.categoryId;
          subcategoryId = resolved.subcategoryId;
          category = resolved.categoryName;

          if (authUser.account_type === AccountType.TRAINER) {
            const profileCatId = await clipTaxonomyService.findCategoryIdByName(
              String(authUser.category || "")
            );
            if (profileCatId && profileCatId !== String(body.category_id)) {
              return res.status(400).json({
                success: 0,
                message: "Category must match your trainer profile category.",
              });
            }
          }
        } catch (taxErr: any) {
          return res.status(400).json({ success: 0, message: taxErr?.message || "Invalid taxonomy" });
        }
      } else if (!category) {
        return res.status(400).json({
          success: 0,
          message: "category_id and subcategory_id are required.",
        });
      }

      if (!videoKey || !thumbnailKey || !title) {
        return res.status(400).json({ success: 0, message: "Missing required clip fields." });
      }
      if (!keyOwnedByUser(videoKey, userId, "clips") || !keyOwnedByUser(thumbnailKey, userId, "thumbnails")) {
        return res.status(400).json({ success: 0, message: "Invalid upload keys for this account." });
      }
      if (fileSizeBytes <= 0) {
        return res.status(400).json({ success: 0, message: "fileSizeBytes is required." });
      }
      if (fileSizeBytes > MAX_CLIP_FILE_BYTES) {
        return res.status(400).json({
          success: 0,
          message: `Each clip must be ${MAX_CLIP_FILE_BYTES} bytes or smaller (50 MB).`,
          maxClipFileBytes: MAX_CLIP_FILE_BYTES,
        });
      }

      const share = await resolveShareUserIds(authUser, body.shareOptions);
      if (share.ok === false) {
        return res.status(share.status).json({ success: 0, message: share.message });
      }

      for (const uid of share.userIds) {
        const quota = await storageService.assertQuota(uid, fileSizeBytes);
        if (!quota.ok) {
          return res.status(CONSTANCE.RES_CODE.error.badRequest).json({
            success: 0,
            message: quota.message,
            usedBytes: quota.usedBytes,
            quotaBytes: quota.quotaBytes,
          });
        }
      }

      const sharerId = userId;
      const savedClips: any[] = [];
      const usersToEmail: Record<
        string,
        { thumbnails: { url: string; title: string }[]; isNewUser: boolean }
      > = {};

      for (const targetUserId of share.userIds) {
        const isRecipientCopy = share.sharingWithFriends && String(targetUserId) !== sharerId;
        const clipObj = new clip({
          title,
          category,
          ...(categoryId ? { category_id: categoryId, subcategory_id: subcategoryId } : {}),
          clip_scope: "personal",
          file_name: videoKey,
          thumbnail: thumbnailKey,
          file_type: fileType,
          file_size_bytes: fileSizeBytes,
          user_id: targetUserId,
          user_type: authUser.account_type,
          ...(isRecipientCopy
            ? { shared_from_user_id: sharerId, shared_at: new Date() }
            : {}),
        });
        await clipObj.save();
        void recordUserActivity(String(targetUserId), UserActivityEvent.CLIP_CREATED, {
          clipId: String(clipObj._id),
          title: clipObj.title,
        });
        savedClips.push(clipObj);

        if (
          share.sharingWithFriends ||
          (share.isNewUser && body.shareOptions?.type === SHARE_NEW_USERS)
        ) {
          if (!usersToEmail[targetUserId]) {
            usersToEmail[targetUserId] = {
              thumbnails: [],
              isNewUser: share.isNewUser && body.shareOptions?.type === SHARE_NEW_USERS,
            };
          }
          usersToEmail[targetUserId].thumbnails.push({
            url: `https://data.netqwix.com/${clipObj.thumbnail}`,
            title: clipObj.title || "Untitled Video",
          });
        }
      }

      await storageService.syncUsedBytes(sharerId);

      for (const [targetId, data] of Object.entries(usersToEmail)) {
        const userData = data.isNewUser
          ? await ReferredUser.findById(targetId)
          : await user.findById(targetId);
        if (!userData?.email) continue;
        const templateName = data.isNewUser ? "clip-shared-new-user" : "clip-shared";
        const isSingleVideo = data.thumbnails.length === 1;
        let thumbnailsGridHTML = "";
        if (isSingleVideo) {
          const video = data.thumbnails[0];
          thumbnailsGridHTML = `
            <img src="${video.url}" alt="Video Thumbnail" style="width:100%; max-width: 200px; border: 1px solid #ddd; border-radius: 4px;"/>
            <div style="margin-top: 5px; font-size: 14px; font-weight: bold;">${video.title}</div>
          `;
        } else {
          thumbnailsGridHTML = data.thumbnails
            .map(
              (video, index) => `
            <td style="padding: 7px; vertical-align: top; width: 50%;">
              <img src="${video.url}" alt="Video Thumbnail" style="width:100%; max-width: 200px; border: 1px solid #ddd; border-radius: 4px;"/>
              <div style="margin-top: 5px; font-size: 14px; font-weight: bold;">${video.title}</div>
            </td>
            ${(index + 1) % 2 === 0 ? "</tr><tr>" : ""}
          `
            )
            .join("");
        }
        const displaySingle =
          data.thumbnails.length === 1
            ? `<div style="text-align: center; margin: 20px 0;">${thumbnailsGridHTML}</div>`
            : "";
        const displayMultiple =
          data.thumbnails.length > 1
            ? `<div style="text-align: center; margin: 20px 0;">
            <h3 style="margin-bottom: 15px;">Shared Videos:</h3>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width: 500px; margin: 0 auto;">
              <tr>${thumbnailsGridHTML}</tr>
            </table></div>`
            : "";

        await SendEmail.sendRawEmail(
          templateName,
          {
            "[TRAINER/TRAINEE NAME]": authUser.fullname,
            "[TRAINER/TRAINEE NAME2]": authUser.fullname,
            "[DISPLAY_SINGLE]": displaySingle,
            "[DISPLAY_MULTIPLE]": displayMultiple,
          },
          [userData.email],
          `Your friend ${authUser.fullname} has shared ${data.thumbnails.length} video(s) in your NetQwix Locker!`
        );
      }

      const primary = savedClips.find((c) => String(c.user_id) === sharerId) ?? savedClips[0];

      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        clipId: primary ? String(primary._id) : null,
        clips: savedClips,
      });
    } catch (err: any) {
      console.error("[clipConfirm] error", err);
      return res.status(500).json({ success: 0, message: "Failed to save clip." });
    }
  }
}

export const clipConfirmService = new ClipConfirmService();
