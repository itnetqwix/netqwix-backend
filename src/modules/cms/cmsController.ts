/**
 * Mobile CMS — legal docs, blogs/pages, manifest for OTA-style refresh.
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import { CONSTANCE } from "../../config/constance";
import CmsFaq from "../../model/cms_faq.schema";
import CmsLegalDocument from "../../model/cms_legal_document.schema";
import CmsPage from "../../model/cms_page.schema";
import HomeBanner from "../../model/home_banner.schema";
import Tip from "../../model/tip.schema";
import { assertAdminUser } from "../admin/adminPermission";
import { DEFAULT_MOBILE_FAQ_SECTIONS } from "./cmsFaqDefaults";
import { computeContentVersion, notifyCmsUpdated } from "./cmsNotify";

function adminDenied(req: Request): string | null {
  return assertAdminUser((req as any)?.authUser);
}

function audiencesForCaller(req: Request): string[] {
  const authUser = (req as any)?.authUser;
  if (!authUser) return ["guest", "all"];
  const at = String(authUser.account_type ?? "").toLowerCase();
  if (at === "trainer") return ["all", "trainer"];
  if (at === "trainee") return ["all", "trainee"];
  return ["all"];
}

function serializeLegal(doc: any) {
  return {
    slug: doc.slug,
    title: doc.title,
    body_html: doc.body_html,
    version: doc.version ?? 1,
    published_at: doc.published_at ?? doc.updatedAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

function serializePage(doc: any, opts?: { includeBody?: boolean }) {
  const base = {
    _id: String(doc._id),
    type: doc.type,
    slug: doc.slug,
    title: doc.title,
    excerpt: doc.excerpt ?? "",
    cover_image_url: doc.cover_image_url ?? null,
    video_url: doc.video_url ?? null,
    cta_label: doc.cta_label ?? null,
    cta_url: doc.cta_url ?? null,
    sort_order: doc.sort_order ?? 0,
    published_at: doc.published_at ?? doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
  if (opts?.includeBody) {
    return { ...base, body_html: doc.body_html ?? "" };
  }
  return base;
}

/* ─── Public ─────────────────────────────────────────────────────── */

function serializeFaq(doc: any) {
  const sections = (doc.sections ?? []).map((s: any, si: number) => ({
    title: s.title,
    sort_order: s.sort_order ?? si,
    items: (s.items ?? []).map((it: any, ii: number) => ({
      id: it._id ? String(it._id) : `faq-${si}-${ii}`,
      q: it.question,
      a: it.answer,
      sort_order: it.sort_order ?? ii,
    })),
  }));
  return {
    version: doc.version ?? 1,
    sections,
    updatedAt: doc.updatedAt ?? null,
  };
}

function sanitizeFaqSections(input: any): Array<{
  title: string;
  sort_order: number;
  items: Array<{ question: string; answer: string; sort_order: number }>;
}> {
  if (!Array.isArray(input)) return [];
  return input
    .map((sec, si) => {
      const title = String(sec?.title ?? "").trim();
      if (!title) return null;
      const items = Array.isArray(sec?.items)
        ? sec.items
            .map((it: any, ii: number) => {
              const question = String(it?.question ?? it?.q ?? "").trim();
              const answer = String(it?.answer ?? it?.a ?? "").trim();
              if (!question || !answer) return null;
              return {
                question,
                answer,
                sort_order: typeof it?.sort_order === "number" ? it.sort_order : ii,
              };
            })
            .filter(Boolean)
        : [];
      return {
        title,
        sort_order: typeof sec?.sort_order === "number" ? sec.sort_order : si,
        items,
      };
    })
    .filter(Boolean) as Array<{
    title: string;
    sort_order: number;
    items: Array<{ question: string; answer: string; sort_order: number }>;
  }>;
}

export async function getCmsManifest(_req: Request, res: Response) {
  try {
    const [legal, contentVersion, faq] = await Promise.all([
      CmsLegalDocument.find({ is_active: true }).select("slug version updatedAt").lean(),
      computeContentVersion(),
      CmsFaq.findOne({ slug: "mobile", is_active: true }).select("version updatedAt").lean(),
    ]);
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        content_version: contentVersion,
        legal: legal.map((l) => ({ slug: l.slug, version: l.version ?? 1 })),
        faq_version: faq?.version ?? 0,
        updated_at: new Date(contentVersion).toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function getCmsFaq(_req: Request, res: Response) {
  try {
    const doc = await CmsFaq.findOne({ slug: "mobile", is_active: true }).lean();
    if (!doc || !(doc.sections ?? []).length) {
      return res.status(200).send({
        status: CONSTANCE.SUCCESS,
        data: { version: 0, sections: [] },
      });
    }
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serializeFaq(doc) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function getLegalBySlug(req: Request, res: Response) {
  try {
    const slug = String(req.params?.slug ?? "").toLowerCase();
    if (!["terms", "privacy"].includes(slug)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid slug." });
    }
    const doc = await CmsLegalDocument.findOne({ slug, is_active: true }).lean();
    if (!doc) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Document not found." });
    }
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serializeLegal(doc) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function listCmsPages(req: Request, res: Response) {
  try {
    const type = String(req.query?.type ?? "blog").toLowerCase();
    if (!["blog", "page"].includes(type)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid type." });
    }
    const audiences = audiencesForCaller(req);
    const now = new Date();
    const rows = await CmsPage.find({
      type,
      is_active: true,
      audience: { $in: audiences },
      $or: [{ published_at: null }, { published_at: { $lte: now } }],
    })
      .sort({ sort_order: 1, published_at: -1, createdAt: -1 })
      .limit(50)
      .lean();
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: rows.map((r) => serializePage(r, { includeBody: false })),
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function getCmsPageBySlug(req: Request, res: Response) {
  try {
    const slug = String(req.params?.slug ?? "").toLowerCase().trim();
    const type = String(req.query?.type ?? "blog").toLowerCase();
    const audiences = audiencesForCaller(req);
    const doc = await CmsPage.findOne({
      slug,
      type,
      is_active: true,
      audience: { $in: audiences },
    }).lean();
    if (!doc) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Page not found." });
    }
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: serializePage(doc, { includeBody: true }),
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Admin legal ────────────────────────────────────────────────── */

export async function adminListLegal(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const rows = await CmsLegalDocument.find().sort({ slug: 1 }).lean();
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: rows.map(serializeLegal) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminUpsertLegal(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const slug = String(req.params?.slug ?? req.body?.slug ?? "").toLowerCase();
    if (!["terms", "privacy"].includes(slug)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid slug." });
    }
    const body = req.body ?? {};
    if (!body.title || !body.body_html) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "title and body_html are required." });
    }
    const existing = await CmsLegalDocument.findOne({ slug }).lean();
    const nextVersion = (existing?.version ?? 0) + 1;
    const doc = await CmsLegalDocument.findOneAndUpdate(
      { slug },
      {
        $set: {
          slug,
          title: String(body.title).trim(),
          body_html: String(body.body_html),
          version: nextVersion,
          is_active: body.is_active !== false,
          published_at: new Date(),
          created_by: (req as any)?.authUser?._id ?? null,
        },
      },
      { upsert: true, new: true }
    ).lean();
    void notifyCmsUpdated("legal").catch(() => {});
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serializeLegal(doc) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Admin FAQ ──────────────────────────────────────────────────── */

export async function adminGetFaq(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const doc = await CmsFaq.findOne({ slug: "mobile" }).lean();
    if (!doc) {
      return res.status(200).send({
        status: CONSTANCE.SUCCESS,
        data: { version: 0, sections: [], is_active: false },
      });
    }
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: { ...serializeFaq(doc), is_active: doc.is_active !== false },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminUpsertFaq(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const body = req.body ?? {};
    const sections = sanitizeFaqSections(body.sections);
    if (!sections.length) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "At least one section with Q&A items is required." });
    }
    const existing = await CmsFaq.findOne({ slug: "mobile" }).lean();
    const nextVersion = (existing?.version ?? 0) + 1;
    const doc = await CmsFaq.findOneAndUpdate(
      { slug: "mobile" },
      {
        $set: {
          slug: "mobile",
          sections,
          version: nextVersion,
          is_active: body.is_active !== false,
          published_at: new Date(),
          created_by: (req as any)?.authUser?._id ?? null,
        },
      },
      { upsert: true, new: true }
    ).lean();
    void notifyCmsUpdated("faq").catch(() => {});
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: { ...serializeFaq(doc), is_active: doc?.is_active !== false },
    });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminSeedFaq(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const force = req.body?.force === true;
    const existing = await CmsFaq.findOne({ slug: "mobile" }).lean();
    if (existing?.sections?.length && !force) {
      return res.status(400).send({
        status: CONSTANCE.FAIL,
        error: "FAQ already exists. Pass force: true to overwrite.",
      });
    }
    const sections = DEFAULT_MOBILE_FAQ_SECTIONS.map((s) => ({
      title: s.title,
      sort_order: s.sort_order,
      items: s.items.map((it) => ({
        question: it.question,
        answer: it.answer,
        sort_order: it.sort_order,
      })),
    }));
    const nextVersion = (existing?.version ?? 0) + 1;
    const doc = await CmsFaq.findOneAndUpdate(
      { slug: "mobile" },
      {
        $set: {
          slug: "mobile",
          sections,
          version: nextVersion,
          is_active: true,
          published_at: new Date(),
          created_by: (req as any)?.authUser?._id ?? null,
        },
      },
      { upsert: true, new: true }
    ).lean();
    void notifyCmsUpdated("faq").catch(() => {});
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serializeFaq(doc) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Admin pages ────────────────────────────────────────────────── */

const AUDIENCE_VALUES = ["guest", "trainer", "trainee", "all"] as const;

function sanitizeAudience(input: any): string[] {
  if (!Array.isArray(input)) return ["all"];
  const out = input
    .map((v) => String(v).toLowerCase())
    .filter((v): v is (typeof AUDIENCE_VALUES)[number] =>
      (AUDIENCE_VALUES as readonly string[]).includes(v)
    );
  return out.length ? Array.from(new Set(out)) : ["all"];
}

export async function adminListPages(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const type = String(req.query?.type ?? "").toLowerCase();
    const filter: any = {};
    if (type === "blog" || type === "page") filter.type = type;
    const rows = await CmsPage.find(filter)
      .sort({ sort_order: 1, createdAt: -1 })
      .lean();
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: rows.map((r) => serializePage(r, { includeBody: true })),
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminCreatePage(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const body = req.body ?? {};
    if (!body.title || !body.slug || !body.body_html) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "title, slug, and body_html are required." });
    }
    const created = await CmsPage.create({
      type: body.type === "page" ? "page" : "blog",
      slug: String(body.slug).trim().toLowerCase(),
      title: String(body.title).trim(),
      excerpt: String(body.excerpt ?? "").trim(),
      body_html: String(body.body_html),
      cover_image_url: body.cover_image_url || null,
      video_url: body.video_url || null,
      audience: sanitizeAudience(body.audience),
      cta_label: body.cta_label || null,
      cta_url: body.cta_url || null,
      is_active: body.is_active !== false,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      published_at: body.published_at ? new Date(body.published_at) : new Date(),
      created_by: (req as any)?.authUser?._id ?? null,
    });
    void notifyCmsUpdated("blog").catch(() => {});
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serializePage(created.toObject(), { includeBody: true }) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminUpdatePage(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const body = req.body ?? {};
    const patch: any = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.slug === "string") patch.slug = body.slug.trim().toLowerCase();
    if (typeof body.excerpt === "string") patch.excerpt = body.excerpt.trim();
    if (typeof body.body_html === "string") patch.body_html = body.body_html;
    if ("cover_image_url" in body) patch.cover_image_url = body.cover_image_url || null;
    if ("video_url" in body) patch.video_url = body.video_url || null;
    if (body.type === "blog" || body.type === "page") patch.type = body.type;
    if ("audience" in body) patch.audience = sanitizeAudience(body.audience);
    if ("cta_label" in body) patch.cta_label = body.cta_label || null;
    if ("cta_url" in body) patch.cta_url = body.cta_url || null;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if ("published_at" in body)
      patch.published_at = body.published_at ? new Date(body.published_at) : null;
    const updated = await CmsPage.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Page not found." });
    }
    void notifyCmsUpdated("blog").catch(() => {});
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serializePage(updated, { includeBody: true }) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminDeletePage(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    await CmsPage.findByIdAndDelete(id);
    void notifyCmsUpdated("blog").catch(() => {});
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminTogglePage(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const current = await CmsPage.findById(id).select("is_active").lean();
    if (!current) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Page not found." });
    }
    const updated = await CmsPage.findByIdAndUpdate(
      id,
      { $set: { is_active: !current.is_active } },
      { new: true }
    ).lean();
    void notifyCmsUpdated("blog").catch(() => {});
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serializePage(updated, { includeBody: true }) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
