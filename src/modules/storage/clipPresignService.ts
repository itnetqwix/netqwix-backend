import { randomBytes } from "crypto";
import { Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { MAX_CLIP_FILE_BYTES } from "../../config/storageLimits";
import { storageService } from "../storage/storageService";

const AWS = require("aws-sdk");
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION,
});

const S3_BUCKET = process.env.AWS_S3_BUCKET;

const ALLOWED_CLIP_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/mpeg",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DEFAULT_MAX_BYTES = MAX_CLIP_FILE_BYTES;

function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/mpeg": "mpeg",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return map[contentType] || "bin";
}

export type ClipPresignInput = {
  filename?: string;
  contentType: string;
  sizeBytes?: number;
  purpose?: "clip" | "thumbnail";
};

export class ClipPresignService {
  async createPresignedUpload(
    userId: string,
    input: ClipPresignInput
  ): Promise<
    | { ok: true; uploadUrl: string; key: string; mediaUrl: string; expiresIn: number }
    | {
        ok: false;
        status: number;
        message: string;
        maxClipFileBytes?: number;
        usedBytes?: number;
        quotaBytes?: number;
      }
  > {
    const contentType = String(input.contentType || "").trim().toLowerCase();
    if (!ALLOWED_CLIP_TYPES.has(contentType)) {
      return {
        ok: false,
        status: 400,
        message: `Unsupported content type: ${contentType}`,
      };
    }

    const maxBytes = Number(process.env.CLIP_UPLOAD_MAX_BYTES || DEFAULT_MAX_BYTES);
    const sizeBytes = Number(input.sizeBytes || 0);
    if (sizeBytes > 0 && sizeBytes > maxBytes) {
      return {
        ok: false,
        status: 400,
        message: `Each clip must be 50 MB or smaller.`,
        maxClipFileBytes: maxBytes,
      };
    }

    const isThumbnail = input.purpose === "thumbnail";
    if (!isThumbnail) {
      if (sizeBytes <= 0) {
        return { ok: false, status: 400, message: "fileSizeBytes is required for clip uploads." };
      }
      const quota = await storageService.assertQuota(userId, sizeBytes);
      if (!quota.ok) {
        return {
          ok: false,
          status: 400,
          message: quota.message || "Storage quota exceeded.",
          usedBytes: quota.usedBytes,
          quotaBytes: quota.quotaBytes,
        };
      }
    }

    const ext = extFromContentType(contentType);
    const purpose = input.purpose === "thumbnail" ? "thumbnails" : "clips";
    const key = `${purpose}/${userId}/${Date.now()}_${randomBytes(8).toString("hex")}.${ext}`;
    const expiresIn = 900;

    const uploadUrl = await s3.getSignedUrlPromise("putObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: expiresIn,
      ContentType: contentType,
    });

    const mediaUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    return { ok: true, uploadUrl, key, mediaUrl, expiresIn };
  }

  async presignHandler(req: any, res: Response) {
    try {
      const userId = String(req.authUser?._id || "");
      if (!userId) {
        return res.status(401).json({ success: 0, message: "Unauthorized" });
      }

      const result = await this.createPresignedUpload(userId, {
        filename: req.body?.filename,
        contentType: req.body?.contentType || req.body?.fileType,
        sizeBytes: Number(req.body?.sizeBytes ?? req.body?.fileSizeBytes ?? 0),
        purpose: req.body?.purpose,
      });

      if (result.ok === false) {
        return res.status(result.status).json({ success: 0, message: result.message });
      }

      return res.status(CONSTANCE.RES_CODE.success).json({
        success: 1,
        uploadUrl: result.uploadUrl,
        key: result.key,
        mediaUrl: result.mediaUrl,
        expiresIn: result.expiresIn,
      });
    } catch (err: any) {
      console.error("[clipPresign] error", err);
      return res.status(500).json({ success: 0, message: "Failed to generate upload URL" });
    }
  }
}

export const clipPresignService = new ClipPresignService();
