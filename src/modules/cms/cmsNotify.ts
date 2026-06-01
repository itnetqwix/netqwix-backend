import CmsFaq from "../../model/cms_faq.schema";
import CmsLegalDocument from "../../model/cms_legal_document.schema";
import CmsPage from "../../model/cms_page.schema";
import HomeBanner from "../../model/home_banner.schema";
import Tip from "../../model/tip.schema";
import { publishSocketBroadcast } from "../../services/eventPubSub";

/** Must match mobile `CMS_SOCKET_EVENT`. */
export const CMS_SOCKET_EVENT = "CMS_UPDATED";

export type CmsNotifyScope =
  | "all"
  | "banners"
  | "tips"
  | "legal"
  | "blog"
  | "faq";

export async function computeContentVersion(): Promise<number> {
  const [legal, pages, banners, tips, faq] = await Promise.all([
    CmsLegalDocument.find({ is_active: true }).select("updatedAt").lean(),
    CmsPage.find({ is_active: true }).select("updatedAt").lean(),
    HomeBanner.find({ is_active: true }).select("updatedAt").sort({ updatedAt: -1 }).limit(1).lean(),
    Tip.find({ is_active: true }).select("updatedAt").sort({ updatedAt: -1 }).limit(1).lean(),
    CmsFaq.findOne({ slug: "mobile", is_active: true }).select("updatedAt").lean(),
  ]);
  const stamps = [
    ...legal.map((l) => new Date(l.updatedAt as Date).getTime()),
    ...pages.map((p) => new Date(p.updatedAt as Date).getTime()),
    banners[0]?.updatedAt ? new Date(banners[0].updatedAt as Date).getTime() : 0,
    tips[0]?.updatedAt ? new Date(tips[0].updatedAt as Date).getTime() : 0,
    faq?.updatedAt ? new Date(faq.updatedAt as Date).getTime() : 0,
  ].filter(Boolean);
  return stamps.length ? Math.max(...stamps) : Date.now();
}

/** Push instant CMS refresh to all connected apps (Socket.IO broadcast). */
export async function notifyCmsUpdated(scope: CmsNotifyScope = "all"): Promise<void> {
  const content_version = await computeContentVersion();
  await publishSocketBroadcast(CMS_SOCKET_EVENT, {
    content_version,
    scope,
    updated_at: new Date().toISOString(),
  });
}
