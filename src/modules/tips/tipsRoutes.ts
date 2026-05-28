import { Router } from "express";
import { optionalAuthorize } from "../../middleware/optionalAuthorize.middleware";
import { listActiveTips } from "./tipsController";

const route: Router = Router();

/** Tips are public; optional auth scopes audience (trainer vs trainee). */
route.get("/", optionalAuthorize, listActiveTips);

export const tipsRoute: Router = route;
