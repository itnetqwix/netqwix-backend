import { Router } from "express";
import { optionalAuthorize } from "../../middleware/optionalAuthorize.middleware";
import {
  getCmsFaq,
  getCmsManifest,
  getCmsPageBySlug,
  getLegalBySlug,
  listCmsPages,
} from "./cmsController";
import { getCmsHome } from "./cmsHomeController";

const route = Router();

route.get("/home", optionalAuthorize, getCmsHome);
route.get("/manifest", getCmsManifest);
route.get("/faq", getCmsFaq);
route.get("/legal/:slug", getLegalBySlug);
route.get("/pages", optionalAuthorize, listCmsPages);
route.get("/pages/:slug", optionalAuthorize, getCmsPageBySlug);

export const cmsRoute = route;
