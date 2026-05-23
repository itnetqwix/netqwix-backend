import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { assertAdminUser } from "../admin/adminPermission";
import { clipTaxonomyService } from "./clipTaxonomyService";
import { clipListService } from "./clipListService";
import { clipLibrarySubmissionService } from "./clipLibrarySubmissionService";
import { clipLibraryAdminService } from "./clipLibraryAdminService";
import { traineeAccountReviewService } from "./traineeAccountReviewService";
import { AccountType } from "../auth/authEnum";

export class ClipsController {
  getTaxonomy = async (_req: Request, res: Response) => {
    try {
      const data = await clipTaxonomyService.getPublicTaxonomy();
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to load taxonomy" });
    }
  };

  getMyClipsGrouped = async (req: any, res: Response) => {
    try {
      const data = await clipListService.getMyClipsGrouped(
        String(req.authUser._id),
        req.body?.trainee_id ?? null
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to load clips" });
    }
  };

  getSharedClipsGrouped = async (req: any, res: Response) => {
    try {
      const data = await clipListService.getSharedClipsGrouped(String(req.authUser._id));
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to load shared clips" });
    }
  };

  getLibraryClipsGrouped = async (_req: any, res: Response) => {
    try {
      const data = await clipListService.getLibraryClipsGrouped();
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to load library" });
    }
  };

  createLibrarySubmission = async (req: any, res: Response) => {
    try {
      const doc = await clipLibrarySubmissionService.createSubmission(req.authUser, req.body);
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data: doc });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message || "Failed to submit" });
    }
  };

  listMyLibrarySubmissions = async (req: any, res: Response) => {
    try {
      const items = await clipLibrarySubmissionService.listMine(String(req.authUser._id));
      return res.status(CONSTANCE.RES_CODE.success).json({ data: items });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message || "Failed to list submissions" });
    }
  };

  // --- Admin taxonomy ---
  adminListTaxonomy = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await clipTaxonomyService.listCategoriesAdmin();
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message });
    }
  };

  adminCreateCategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const doc = await clipTaxonomyService.createCategory(req.body.name, String(req.authUser._id));
      return res.status(CONSTANCE.RES_CODE.success).json({ data: doc });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminUpdateCategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const doc = await clipTaxonomyService.updateCategory(req.params.id, req.body);
      return res.status(CONSTANCE.RES_CODE.success).json({ data: doc });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminDeleteCategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      await clipTaxonomyService.deleteCategory(req.params.id);
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1 });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminCreateSubcategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const doc = await clipTaxonomyService.createSubcategory(
        req.body.category_id,
        req.body.name,
        String(req.authUser._id)
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ data: doc });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminUpdateSubcategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const doc = await clipTaxonomyService.updateSubcategory(req.params.id, req.body);
      return res.status(CONSTANCE.RES_CODE.success).json({ data: doc });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminDeleteSubcategory = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      await clipTaxonomyService.deleteSubcategory(req.params.id);
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1 });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  // --- Admin library ---
  adminLibraryPresign = (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    return clipLibraryAdminService.presignLibraryClip(req, res);
  };

  adminLibraryConfirm = (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    return clipLibraryAdminService.confirmLibraryClip(req, res);
  };

  adminLibraryList = (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    return clipLibraryAdminService.listLibraryGrouped(req, res);
  };

  adminDeleteLibraryClip = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      await clipLibraryAdminService.deleteLibraryClip(req.params.clipId);
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1 });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  // --- Admin submissions ---
  adminListSubmissions = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await clipLibrarySubmissionService.listAdmin(req.query);
      return res.status(CONSTANCE.RES_CODE.success).json({ data });
    } catch (err: any) {
      return res.status(500).json({ success: 0, message: err?.message });
    }
  };

  adminApproveSubmission = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await clipLibrarySubmissionService.approve(
        req.params.id,
        String(req.authUser._id),
        req.body
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminRejectSubmission = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await clipLibrarySubmissionService.reject(
        req.params.id,
        String(req.authUser._id),
        req.body.reason
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminMarkSubmissionReview = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await clipLibrarySubmissionService.markUnderReview(
        req.params.id,
        String(req.authUser._id)
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  // --- Trainee account ---
  adminRejectTrainee = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await traineeAccountReviewService.rejectTrainee(
        req.params.userId,
        String(req.authUser._id),
        req.body.reason
      );
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  adminApproveTrainee = async (req: any, res: Response) => {
    const denied = assertAdminUser(req.authUser);
    if (denied) return res.status(403).json({ success: 0, message: denied });
    try {
      const data = await traineeAccountReviewService.approveTrainee(req.params.userId);
      return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };

  reapplyAccount = async (req: any, res: Response) => {
    try {
      const userId = String(req.authUser._id);
      if (req.authUser.account_type === AccountType.TRAINER) {
        const { trainerReviewService } = await import("../verification/trainerReviewService");
        const data = await trainerReviewService.reapply(userId);
        return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
      }
      if (req.authUser.account_type === AccountType.TRAINEE) {
        const data = await traineeAccountReviewService.reapplyTrainee(userId);
        return res.status(CONSTANCE.RES_CODE.success).json({ success: 1, data });
      }
      return res.status(400).json({ success: 0, message: "Unsupported account type" });
    } catch (err: any) {
      return res.status(400).json({ success: 0, message: err?.message });
    }
  };
}

export const clipsController = new ClipsController();
