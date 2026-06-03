import { Router } from "express";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { clipsController } from "./clipsController";

const route = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const c = clipsController;

route.use(authorizeMiddleware.authorizeUser);

// Public taxonomy (authenticated users)
route.get("/taxonomy", c.getTaxonomy);

// User library submissions
route.post("/library-submissions", c.createLibrarySubmission);
route.get("/library-submissions/mine", c.listMyLibrarySubmissions);
route.post("/account/reapply", c.reapplyAccount);

route.post("/share-requests", c.createShareRequests);
route.get("/share-requests/inbox", c.listShareInbox);
route.get("/share-requests/outbox", c.listShareOutbox);
route.post("/share-requests/:requestId/respond", c.respondShareRequest);
route.post("/share-requests/:requestId/cancel", c.cancelShareRequest);

export const clipsRoute: Router = route;

/** Mounted under /admin — admin-only clip & library management */
export function mountAdminClipRoutes(adminRouter: Router) {
  adminRouter.get("/clip-categories", c.adminListTaxonomy);
  adminRouter.post("/clip-categories", c.adminCreateCategory);
  adminRouter.put("/clip-categories/:id", c.adminUpdateCategory);
  adminRouter.delete("/clip-categories/:id", c.adminDeleteCategory);

  adminRouter.post("/clip-subcategories", c.adminCreateSubcategory);
  adminRouter.put("/clip-subcategories/:id", c.adminUpdateSubcategory);
  adminRouter.delete("/clip-subcategories/:id", c.adminDeleteSubcategory);

  adminRouter.post("/library/clips/presign", c.adminLibraryPresign);
  adminRouter.post("/library/clips/confirm", c.adminLibraryConfirm);
  adminRouter.get("/library/clips", c.adminLibraryList);
  adminRouter.delete("/library/clips/:clipId", c.adminDeleteLibraryClip);

  adminRouter.get("/library-submissions", c.adminListSubmissions);
  adminRouter.post("/library-submissions/:id/under-review", c.adminMarkSubmissionReview);
  adminRouter.post("/library-submissions/:id/approve", c.adminApproveSubmission);
  adminRouter.post("/library-submissions/:id/reject", c.adminRejectSubmission);

  adminRouter.post("/trainee-accounts/:userId/reject", c.adminRejectTrainee);
  adminRouter.post("/trainee-accounts/:userId/approve", c.adminApproveTrainee);
}
