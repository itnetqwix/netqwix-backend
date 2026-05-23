import mongoose from "mongoose";
import clip from "../../model/clip.schema";
import clip_library_submission from "../../model/clip_library_submission.schema";
import { clipTaxonomyService } from "./clipTaxonomyService";
import { AccountType } from "../auth/authEnum";

const ACTIVE_CLIP = { $or: [{ status: true }, { status: { $exists: false } }] };
const OPEN_STATUSES = ["submitted", "under_review"];

export class ClipLibrarySubmissionService {
  async createSubmission(
    authUser: any,
    body: { source_clip_id: string; proposed_category_id: string; proposed_subcategory_id: string }
  ) {
    const userId = String(authUser._id);
    const sourceId = String(body.source_clip_id || "").trim();
    if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
      throw new Error("Invalid source clip");
    }

    await clipTaxonomyService.resolveCategoryIds(
      body.proposed_category_id,
      body.proposed_subcategory_id
    );

    const source = await clip.findOne({
      _id: sourceId,
      user_id: userId,
      clip_scope: { $ne: "library" },
      ...ACTIVE_CLIP,
      $or: [{ shared_from_user_id: null }, { shared_from_user_id: { $exists: false } }],
    });
    if (!source) throw new Error("Clip not found or not eligible for library submission");

    const existingOpen = await clip_library_submission.findOne({
      source_clip_id: sourceId,
      status: { $in: OPEN_STATUSES },
    });
    if (existingOpen) throw new Error("This clip already has a pending library request");

    const accepted = await clip_library_submission.findOne({
      source_clip_id: sourceId,
      status: "accepted",
    });
    if (accepted) throw new Error("This clip is already in the Netqwix Library");

    if (authUser.account_type === AccountType.TRAINER) {
      const profileCatId = await clipTaxonomyService.findCategoryIdByName(
        String(authUser.category || "")
      );
      if (profileCatId && profileCatId !== body.proposed_category_id) {
        throw new Error("Proposed category must match your trainer profile category");
      }
    }

    const doc = await clip_library_submission.create({
      source_clip_id: sourceId,
      requester_user_id: userId,
      proposed_category_id: body.proposed_category_id,
      proposed_subcategory_id: body.proposed_subcategory_id,
      status: "submitted",
    });

    return doc;
  }

  async listMine(userId: string) {
    return clip_library_submission
      .find({ requester_user_id: userId })
      .sort({ createdAt: -1 })
      .populate("source_clip_id", "title thumbnail file_name")
      .lean();
  }

  async listAdmin(query: Record<string, unknown> = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const filter: Record<string, unknown> = {};
    const statusParam = String(query.status ?? "").trim().toLowerCase();
    if (statusParam && statusParam !== "all") {
      filter.status = statusParam;
    } else if (!statusParam) {
      filter.status = { $in: OPEN_STATUSES };
    }

    const [items, total, pendingCount, underReviewCount] = await Promise.all([
      clip_library_submission
        .find(filter)
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("source_clip_id")
        .populate("requester_user_id", "fullname email account_type category profile_picture")
        .populate("proposed_category_id", "name")
        .populate("proposed_subcategory_id", "name")
        .populate("assigned_category_id", "name")
        .populate("assigned_subcategory_id", "name")
        .lean(),
      clip_library_submission.countDocuments(filter),
      clip_library_submission.countDocuments({ status: "submitted" }),
      clip_library_submission.countDocuments({ status: "under_review" }),
    ]);
    return { items, total, page, limit, pendingCount, underReviewCount };
  }

  async approve(
    submissionId: string,
    adminId: string,
    body: { category_id: string; subcategory_id: string }
  ) {
    const sub = await clip_library_submission.findById(submissionId);
    if (!sub) throw new Error("Submission not found");
    if (!OPEN_STATUSES.includes(sub.status)) {
      throw new Error("Submission is not pending review");
    }

    const resolved = await clipTaxonomyService.resolveCategoryIds(
      body.category_id,
      body.subcategory_id
    );

    const source = await clip.findById(sub.source_clip_id).lean();
    if (!source) throw new Error("Source clip not found");

    const libraryClip = await clip.create({
      title: source.title,
      category: resolved.categoryName,
      category_id: resolved.categoryId,
      subcategory_id: resolved.subcategoryId,
      file_name: source.file_name,
      thumbnail: source.thumbnail,
      file_type: source.file_type,
      file_id: source.file_id,
      file_size_bytes: source.file_size_bytes || 0,
      user_id: sub.requester_user_id,
      user_type: "Admin",
      clip_scope: "library",
      library_source_submission_id: sub._id,
      source_clip_id: source._id,
      tags: source.tags || [],
      ai_description: source.ai_description,
      skill_level: source.skill_level,
    });

    sub.status = "accepted";
    sub.assigned_category_id = resolved.categoryId;
    sub.assigned_subcategory_id = resolved.subcategoryId;
    sub.published_library_clip_id = libraryClip._id as mongoose.Types.ObjectId;
    sub.reviewed_by = new mongoose.Types.ObjectId(adminId);
    sub.reviewed_at = new Date();
    sub.rejection_reason = null;
    await sub.save();

    return { submission: sub, libraryClip };
  }

  async reject(submissionId: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw new Error("Rejection reason is required");
    const sub = await clip_library_submission.findById(submissionId);
    if (!sub) throw new Error("Submission not found");
    if (!OPEN_STATUSES.includes(sub.status)) {
      throw new Error("Submission is not pending review");
    }
    sub.status = "rejected";
    sub.rejection_reason = reason.trim();
    sub.reviewed_by = new mongoose.Types.ObjectId(adminId);
    sub.reviewed_at = new Date();
    await sub.save();
    return sub;
  }

  async markUnderReview(submissionId: string, adminId: string) {
    const sub = await clip_library_submission.findById(submissionId);
    if (!sub) throw new Error("Submission not found");
    if (sub.status !== "submitted") throw new Error("Only submitted requests can be marked under review");
    sub.status = "under_review";
    sub.reviewed_by = new mongoose.Types.ObjectId(adminId);
    await sub.save();
    return sub;
  }
}

export const clipLibrarySubmissionService = new ClipLibrarySubmissionService();
