/**
 * Shared CMS query helpers — schedule windows, placement filters, admin counts.
 */

import HomeBanner from "../../model/home_banner.schema";
import Tip from "../../model/tip.schema";

export const BANNER_PLACEMENTS = ["hero", "strip", "sticky_bottom"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

/** Rows visible now per start_date / end_date. */
export function activeScheduleWindow(now: Date = new Date()) {
  return {
    $and: [
      { $or: [{ start_date: null }, { start_date: { $lte: now } }] },
      { $or: [{ end_date: null }, { end_date: { $gte: now } }] },
    ],
  };
}

export function audiencesForBannerCaller(authUser?: { account_type?: string } | null): string[] {
  if (!authUser) return ["guest", "all"];
  const at = String(authUser.account_type ?? "").toLowerCase();
  if (at === "trainer") return ["all", "trainer"];
  if (at === "trainee") return ["all", "trainee"];
  return ["all"];
}

export function audiencesForTipCaller(
  authUser?: { account_type?: string } | null,
  authenticated?: boolean
): string[] {
  if (!authenticated) return ["all", "guest"];
  const at = String(authUser?.account_type ?? "").toLowerCase();
  if (at === "trainer") return ["all", "trainer"];
  if (at === "trainee") return ["all", "trainee"];
  return ["all"];
}

/** Legacy rows without `placement` map to hero/strip/sticky by heuristics. */
export function bannerPlacementFilter(placement: string): Record<string, unknown> | null {
  const p = String(placement ?? "").toLowerCase();
  if (!BANNER_PLACEMENTS.includes(p as BannerPlacement)) return null;
  if (p === "hero") {
    return {
      $or: [
        { placement: "hero" },
        { placement: { $exists: false }, image_url: { $nin: [null, ""] } },
      ],
    };
  }
  if (p === "strip") {
    return {
      $or: [
        { placement: "strip" },
        {
          placement: { $exists: false },
          $or: [{ image_url: null }, { image_url: "" }],
        },
      ],
    };
  }
  return {
    $or: [
      { placement: "sticky_bottom" },
      { placement: { $exists: false }, severity: "promo" },
    ],
  };
}

export function activeBannerFilter(
  audiences: string[],
  placement?: string,
  now: Date = new Date()
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [
    { is_active: true, audience: { $in: audiences } },
    activeScheduleWindow(now),
  ];
  const placementClause = placement ? bannerPlacementFilter(placement) : null;
  if (placementClause) clauses.push(placementClause);
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

export function activeTipFilter(now: Date = new Date()): Record<string, unknown> {
  return {
    is_active: true,
    ...activeScheduleWindow(now),
  };
}

export async function countLiveBanners(placement?: BannerPlacement): Promise<number> {
  const now = new Date();
  const filter = activeBannerFilter(["guest", "all", "trainer", "trainee"], placement, now);
  return HomeBanner.countDocuments(filter);
}

export async function countLiveTips(): Promise<number> {
  return Tip.countDocuments(activeTipFilter());
}

export async function countScheduledBanners(): Promise<number> {
  const now = new Date();
  return HomeBanner.countDocuments({
    is_active: true,
    $or: [{ start_date: { $gt: now } }, { end_date: { $lt: now } }],
  });
}
