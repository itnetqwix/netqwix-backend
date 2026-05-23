import { Response } from "express";
import mongoose from "mongoose";
import clip from "../../model/clip.schema";
import { clipTaxonomyService } from "./clipTaxonomyService";
import { clipPresignService } from "../storage/clipPresignService";
import { MAX_CLIP_FILE_BYTES } from "../../config/storageLimits";
import { CONSTANCE } from "../../config/constance";
import { clipListService } from "./clipListService";

const ADMIN_LIBRARY_PREFIX = "library";

function adminLibraryKey(adminId: string, kind: "clips" | "thumbnails", filename: string): string {
  return `${kind}/${ADMIN_LIBRARY_PREFIX}/${adminId}/${filename}`;
}

export class ClipLibraryAdminService {
  async presignLibraryClip(req: any, res: Response) {
    const adminId = String(req.authUser?._id || "");
    if (!adminId) return res.status(401).json({ success: 0, message: "Unauthorized" });

    try {
      const rawName = String(req.body?.fileName || "video.mp4").trim();
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "video.mp4";
      const uniqueName = `${Date.now()}-${safeName}`;
      const contentType = String(req.body?.contentType || "video/mp4").trim();
      const fileSizeBytes = Number(req.body?.fileSizeBytes || 0);

      if (fileSizeBytes <= 0 || fileSizeBytes > MAX_CLIP_FILE_BYTES) {
        return res.status(400).json({
          success: 0,
          message: `File must be between 1 byte and ${MAX_CLIP_FILE_BYTES} bytes.`,
        });
      }

      const videoKey = adminLibraryKey(adminId, "clips", uniqueName);
      const thumbKey = adminLibraryKey(
        adminId,
        "thumbnails",
        uniqueName.replace(/\.[^.]+$/, "") + "-thumb.jpg"
      );

      const [videoUploadUrl, thumbnailUploadUrl] = await Promise.all([
        clipPresignService.createPresignedPutForKey(videoKey, contentType),
        clipPresignService.createPresignedPutForKey(thumbKey, "image/jpeg"),
      ]);

      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        videoKey,
        thumbnailKey: thumbKey,
        videoUploadUrl,
        thumbnailUploadUrl,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: 0,
        message: err?.message || "Failed to prepare upload",
      });
    }
  }

  async confirmLibraryClip(req: any, res: Response) {
    try {
      const adminId = String(req.authUser?._id || "");
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const videoKey = String(body.videoKey || "").trim();
      const thumbnailKey = String(body.thumbnailKey || "").trim();
      const fileType = String(body.fileType || "video/mp4").trim();
      const fileSizeBytes = Number(body.fileSizeBytes || 0);

      if (!title || !videoKey || !thumbnailKey) {
        return res.status(400).json({ success: 0, message: "Missing required fields" });
      }

      const expectedClipPrefix = `clips/${ADMIN_LIBRARY_PREFIX}/${adminId}/`;
      if (!videoKey.startsWith(expectedClipPrefix)) {
        return res.status(400).json({ success: 0, message: "Invalid video key" });
      }

      const resolved = await clipTaxonomyService.resolveCategoryIds(
        body.category_id,
        body.subcategory_id
      );

      const doc = await clip.create({
        title,
        category: resolved.categoryName,
        category_id: resolved.categoryId,
        subcategory_id: resolved.subcategoryId,
        file_name: videoKey,
        thumbnail: thumbnailKey,
        file_type: fileType,
        file_size_bytes: fileSizeBytes,
        user_id: adminId,
        user_type: "Admin",
        clip_scope: "library",
      });

      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        clipId: String(doc._id),
        clip: doc,
      });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message || "Failed to save library clip" });
    }
  }

  async listLibraryGrouped(_req: any, res: Response) {
    try {
      const data = await clipListService.getLibraryClipsGrouped();
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to list library" });
    }
  }

  async deleteLibraryClip(clipId: string) {
    if (!mongoose.Types.ObjectId.isValid(clipId)) throw new Error("Invalid clip id");
    const doc = await clip.findOneAndUpdate(
      { _id: clipId, clip_scope: "library" },
      { $set: { status: false } },
      { new: true }
    );
    if (!doc) throw new Error("Library clip not found");
    return doc;
  }
}

export const clipLibraryAdminService = new ClipLibraryAdminService();
