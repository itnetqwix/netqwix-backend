import mongoose from "mongoose";
import clip from "../../model/clip.schema";
import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { storageService } from "../storage/storageService";
import { recordUserActivity, UserActivityEvent } from "../../helpers/userActivity";
import { SendEmail } from "../../Utils/sendEmail";

const MAX_CLIPS_PER_REQUEST = 20;

export class ClipShareService {
  private async assertFriends(sharerId: string, friendIds: string[]) {
    const uploaderDoc: any = await user.findById(sharerId).select("friends account_type blockedUsers").lean();
    if (![AccountType.TRAINER, AccountType.TRAINEE].includes(uploaderDoc?.account_type)) {
      return { ok: false as const, message: "Only trainer or trainee accounts can share clips." };
    }
    const friendSet = new Set((uploaderDoc?.friends ?? []).map((id: any) => String(id)));
    const blocked = new Set((uploaderDoc?.blockedUsers ?? []).map((id: any) => String(id)));
    const invalid = friendIds.filter(
      (id) => id === sharerId || !friendSet.has(id) || blocked.has(id)
    );
    if (invalid.length) {
      return {
        ok: false as const,
        message: "You can only share clips with friends on your friends list.",
      };
    }
    return { ok: true as const, uploader: uploaderDoc };
  }

  private async assertOwnClips(sharerId: string, clipIds: string[]) {
    if (!clipIds.length) {
      return { ok: false as const, message: "Select at least one clip." };
    }
    if (clipIds.length > MAX_CLIPS_PER_REQUEST) {
      return {
        ok: false as const,
        message: `You can share up to ${MAX_CLIPS_PER_REQUEST} clips at a time.`,
      };
    }
    const ids = clipIds.map((id) => new mongoose.Types.ObjectId(id));
    const rows = await clip
      .find({
        _id: { $in: ids },
        user_id: new mongoose.Types.ObjectId(sharerId),
        $or: [{ shared_from_user_id: null }, { shared_from_user_id: { $exists: false } }],
        clip_scope: { $ne: "library" },
      })
      .lean();
    if (rows.length !== clipIds.length) {
      return {
        ok: false as const,
        message: "One or more clips are missing or cannot be shared (only your own locker clips).",
      };
    }
    return { ok: true as const, clips: rows };
  }

  /** Copy clips into each friend's locker immediately (same S3 keys, shared_from_user_id set). */
  private async deliverClipsToFriends(params: {
    sharerId: string;
    sharerName: string;
    friendIds: string[];
    sourceClips: any[];
  }) {
    const deliveredByFriend: Record<string, string[]> = {};
    const skipped: { friendId: string; reason: string }[] = [];

    for (const friendId of params.friendIds) {
      const delivered: string[] = [];
      try {
        for (const src of params.sourceClips) {
          const size = Number(src.file_size_bytes ?? 0);
          const quota = await storageService.assertQuota(friendId, size);
          if (!quota.ok) {
            skipped.push({ friendId, reason: quota.message });
            delivered.length = 0;
            break;
          }

          const existing = await clip
            .findOne({
              user_id: friendId,
              source_clip_id: src._id,
              shared_from_user_id: params.sharerId,
              status: { $ne: false },
            })
            .select("_id")
            .lean();
          if (existing) {
            delivered.push(String(existing._id));
            continue;
          }

          const copy = new clip({
            title: src.title,
            category: src.category,
            category_id: src.category_id,
            subcategory_id: src.subcategory_id,
            clip_scope: "personal",
            file_name: src.file_name,
            thumbnail: src.thumbnail,
            file_type: src.file_type,
            file_size_bytes: size,
            user_id: friendId,
            user_type: src.user_type,
            shared_from_user_id: params.sharerId,
            shared_at: new Date(),
            source_clip_id: src._id,
          });
          await copy.save();
          delivered.push(String(copy._id));
          void recordUserActivity(friendId, UserActivityEvent.CLIP_CREATED, {
            clipId: String(copy._id),
            sharedFrom: params.sharerId,
          });
        }

        if (delivered.length) {
          await storageService.syncUsedBytes(friendId);
          deliveredByFriend[friendId] = delivered;

          const recipient = await user
            .findById(friendId)
            .select("email fullname notifications")
            .lean();
          if (recipient?.email && recipient?.notifications?.promotional?.email !== false) {
            void SendEmail.sendRawEmail(
              "clip-shared",
              {
                "[TRAINER/TRAINEE NAME]": params.sharerName,
                "[TRAINER/TRAINEE NAME2]": params.sharerName,
                "[DISPLAY_SINGLE]": "",
                "[DISPLAY_MULTIPLE]": "",
              },
              [recipient.email],
              `${params.sharerName} shared ${params.sourceClips.length} clip(s) in your NetQwix Locker`
            );
          }
        }
      } catch (e: any) {
        skipped.push({ friendId, reason: e?.message || "Failed to share" });
      }
    }

    return { deliveredByFriend, skipped };
  }

  /** Share existing locker clips to friends (immediate copy). */
  async createShareRequests(params: {
    sharerId: string;
    sharerName: string;
    friendIds: string[];
    clipIds: string[];
    message?: string;
  }) {
    const uniqueFriends = [...new Set(params.friendIds.map(String))].filter(
      (id) => id !== String(params.sharerId)
    );
    if (!uniqueFriends.length) {
      return ResponseBuilder.badRequest("Select at least one friend to share with.");
    }

    const friendCheck = await this.assertFriends(params.sharerId, uniqueFriends);
    if (!friendCheck.ok) return ResponseBuilder.badRequest(friendCheck.message);

    const clipCheck = await this.assertOwnClips(params.sharerId, params.clipIds);
    if (!clipCheck.ok) return ResponseBuilder.badRequest(clipCheck.message);

    const { deliveredByFriend, skipped } = await this.deliverClipsToFriends({
      sharerId: params.sharerId,
      sharerName: params.sharerName,
      friendIds: uniqueFriends,
      sourceClips: clipCheck.clips,
    });

    const friendCount = Object.keys(deliveredByFriend).length;
    if (!friendCount) {
      return ResponseBuilder.badRequest(
        skipped[0]?.reason || "Could not share clips with friends."
      );
    }

    return ResponseBuilder.data(
      {
        deliveredByFriend,
        skipped,
        message: "Clips have been added to your friends' lockers. They can remove them anytime.",
      },
      "Clips shared"
    );
  }

  /** Used after upload confirm — share one or more newly saved clips. */
  async shareUploadedClipsToFriends(params: {
    sharerId: string;
    sharerName: string;
    friendIds: string[];
    sourceClips: any[];
  }) {
    const uniqueFriends = [...new Set(params.friendIds.map(String))].filter(
      (id) => id !== String(params.sharerId)
    );
    if (!uniqueFriends.length || !params.sourceClips.length) {
      return ResponseBuilder.data({ deliveredByFriend: {} }, "Nothing to share");
    }

    const friendCheck = await this.assertFriends(params.sharerId, uniqueFriends);
    if (!friendCheck.ok) return ResponseBuilder.badRequest(friendCheck.message);

    const { deliveredByFriend, skipped } = await this.deliverClipsToFriends({
      sharerId: params.sharerId,
      sharerName: params.sharerName,
      friendIds: uniqueFriends,
      sourceClips: params.sourceClips,
    });

    if (!Object.keys(deliveredByFriend).length) {
      return ResponseBuilder.badRequest(
        skipped[0]?.reason || "Failed to share clips with friends."
      );
    }

    return ResponseBuilder.data({ deliveredByFriend, skipped }, "Clips shared");
  }

  async listInbox(_userId: string) {
    return ResponseBuilder.data([], "No pending shares");
  }

  async listOutbox(_userId: string) {
    return ResponseBuilder.data([], "No pending shares");
  }

  async respondToRequest(_params: {
    requestId: string;
    recipientId: string;
    action: "accept" | "decline";
  }) {
    return ResponseBuilder.badRequest(
      "Clip sharing no longer requires acceptance. Clips are added to your locker automatically."
    );
  }

  async cancelRequest(_requestId: string, _sharerId: string) {
    return ResponseBuilder.badRequest("No pending share request to cancel.");
  }
}

export const clipShareService = new ClipShareService();
