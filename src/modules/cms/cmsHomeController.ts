/**
 * Aggregated CMS payloads for mobile home — one round trip for hero, strip, sticky, tips.
 */

import { Request, Response } from "express";
import HomeBanner from "../../model/home_banner.schema";
import Tip from "../../model/tip.schema";
import { CONSTANCE } from "../../config/constance";
import { serializeHomeBanner } from "../banners/bannersController";
import { serializeTip } from "../tips/tipsController";
import {
  activeBannerFilter,
  activeTipFilter,
  audiencesForBannerCaller,
  audiencesForTipCaller,
  countLiveBanners,
  countLiveTips,
  countScheduledBanners,
} from "./cmsContentQuery";
import { computeContentVersion } from "./cmsNotify";
import { assertAdminUser } from "../admin/adminPermission";

const PLACEMENT_LIMITS: Record<string, number> = {
  hero: 12,
  strip: 5,
  sticky_bottom: 8,
};

async function fetchBannersForPlacement(
  audiences: string[],
  placement: "hero" | "strip" | "sticky_bottom"
) {
  const rows = await HomeBanner.find(activeBannerFilter(audiences, placement))
    .sort({ sort_order: 1, createdAt: -1 })
    .limit(PLACEMENT_LIMITS[placement] ?? 10)
    .lean();
  return rows.map(serializeHomeBanner);
}

async function fetchTips(audiences: string[]) {
  const rows = await Tip.find({
    ...activeTipFilter(),
    audience: { $in: audiences },
  })
    .sort({ sort_order: 1, createdAt: -1 })
    .limit(20)
    .lean();
  return rows.map(serializeTip);
}

/** GET /cms/home — banners by placement + tips + content_version (auth optional). */
export async function getCmsHome(req: Request, res: Response) {
  try {
    const authUser = (req as any)?.authUser;
    const bannerAudiences = audiencesForBannerCaller(authUser);
    const tipAudiences = audiencesForTipCaller(authUser, !!authUser);

    const [content_version, hero, strip, sticky_bottom, tips] = await Promise.all([
      computeContentVersion(),
      fetchBannersForPlacement(bannerAudiences, "hero"),
      fetchBannersForPlacement(bannerAudiences, "strip"),
      fetchBannersForPlacement(bannerAudiences, "sticky_bottom"),
      fetchTips(tipAudiences),
    ]);

    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        content_version,
        updated_at: new Date().toISOString(),
        banners: { hero, strip, sticky_bottom },
        tips,
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/** GET /admin/cms/summary — live vs scheduled CMS counts for admin dashboard. */
export async function adminGetCmsSummary(req: Request, res: Response) {
  const denied = assertAdminUser((req as any)?.authUser);
  if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });

  try {
    const [
      content_version,
      liveBanners,
      liveTips,
      liveHero,
      liveStrip,
      liveSticky,
      scheduledOffWindow,
      inactiveBanners,
      inactiveTips,
    ] = await Promise.all([
      computeContentVersion(),
      countLiveBanners(),
      countLiveTips(),
      countLiveBanners("hero"),
      countLiveBanners("strip"),
      countLiveBanners("sticky_bottom"),
      countScheduledBanners(),
      HomeBanner.countDocuments({ is_active: false }),
      Tip.countDocuments({ is_active: false }),
    ]);

    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        content_version,
        updated_at: new Date().toISOString(),
        live: {
          banners: liveBanners,
          tips: liveTips,
          banners_hero: liveHero,
          banners_strip: liveStrip,
          banners_sticky_bottom: liveSticky,
        },
        scheduled_off_window: scheduledOffWindow,
        inactive: {
          banners: inactiveBanners,
          tips: inactiveTips,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
