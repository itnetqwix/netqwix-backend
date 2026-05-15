import { Router } from "express";
import { AIController } from "./aiController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const route: Router = Router();
const authorizeMiddleware = new AuthorizeMiddleware();
const controller = new AIController();

route.use([
  (req, _res, next) => {
    req.byPassRoute = [];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);

route.get("/recommend-trainers", controller.recommendTrainers);
route.post("/chat-assistant", controller.chatAssistant);
route.get("/lesson-summary/:sessionId", controller.lessonSummary);
route.post("/tag-clip/:clipId", controller.tagClip);
route.get("/enhance-profile", controller.enhanceProfile);
route.post("/apply-enhanced-profile", controller.applyEnhancedProfile);
route.get("/smart-schedule/:trainerId", controller.smartSchedule);
route.get("/review-analysis", controller.reviewAnalysis);
route.get("/smart-search", controller.smartSearch);

export const aiRoute: Router = route;
