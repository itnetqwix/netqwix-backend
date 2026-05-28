import { Router } from "express";
import { optionalAuthorize } from "../../middleware/optionalAuthorize.middleware";
import { listActiveBanners } from "./bannersController";

const route: Router = Router();

/** Banners are guest-visible; optional auth scopes audience. */
route.get("/", optionalAuthorize, listActiveBanners);

export const bannersRoute: Router = route;
