import { Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { clipPresignService } from "../storage/clipPresignService";
import { assertAdminUser } from "../admin/adminPermission";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_KINDS = new Set(["banners", "tips", "pages"]);

function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return map[contentType] || "bin";
}

function publicUrlForKey(key: string): string {
  const bucket = process.env.AWS_S3_BUCKET || "";
  const region = process.env.AWS_REGION || "us-east-2";
  if (!bucket) return key;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function adminPresignCmsAsset(req: any, res: Response) {
  const denied = assertAdminUser(req?.authUser);
  if (denied) {
    return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
  }

  const adminId = String(req.authUser?._id || "");
  if (!adminId) {
    return res.status(401).send({ status: CONSTANCE.FAIL, error: "Unauthorized" });
  }

  try {
    const kind = String(req.body?.kind || "banners").toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid kind." });
    }

    const contentType = String(req.body?.contentType || req.body?.fileType || "")
      .trim()
      .toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return res.status(400).send({
        status: CONSTANCE.FAIL,
        error: "Unsupported image type. Use JPEG, PNG, or WebP.",
      });
    }

    const fileSizeBytes = Number(req.body?.fileSizeBytes ?? req.body?.sizeBytes ?? 0);
    if (fileSizeBytes <= 0 || fileSizeBytes > MAX_BYTES) {
      return res.status(400).send({
        status: CONSTANCE.FAIL,
        error: `Image must be between 1 byte and ${MAX_BYTES} bytes.`,
      });
    }

    const rawName = String(req.body?.fileName || "image.jpg").trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "image.jpg";
    const ext = extFromContentType(contentType);
    const uniqueName = `${Date.now()}-${safeName.replace(/\.[^.]+$/, "")}.${ext}`;
    const key = `cms/${kind}/${adminId}/${uniqueName}`;
    const expiresIn = 900;

    const uploadUrl = await clipPresignService.createPresignedPutForKey(
      key,
      contentType,
      expiresIn
    );

    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        key,
        uploadUrl,
        mediaUrl: publicUrlForKey(key),
        expiresIn,
      },
    });
  } catch (err: any) {
    return res.status(500).send({
      status: CONSTANCE.FAIL,
      error: err?.message || "Failed to prepare upload",
    });
  }
}
