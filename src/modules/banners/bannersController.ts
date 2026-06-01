/**
 * Home banners controller (Phase 2 item 17).
 *
 * Public list:
 *  - Guests (unauthenticated) get banners tagged with audience including
 *    `guest` or `all` — used on the login/auth screens.
 *  - Authenticated users get banners scoped to their account_type.
 *
 * Admin CRUD: full create / update / delete / toggle.
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import { CONSTANCE } from "../../config/constance";
import HomeBanner from "../../model/home_banner.schema";
import { assertAdminUser } from "../admin/adminPermission";
import { notifyCmsUpdated } from "../cms/cmsNotify";

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

function sanitizeCtas(input: any): Array<{ label: string; url: string; variant: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => ({
      label: String(row?.label ?? "").trim(),
      url: String(row?.url ?? "").trim(),
      variant: ["primary", "secondary", "ghost"].includes(String(row?.variant))
        ? String(row.variant)
        : "primary",
    }))
    .filter((row) => row.label && row.url)
    .slice(0, 4);
}

function serialize(b: any) {
  const ctas = sanitizeCtas(b.ctas);
  return {
    _id: String(b._id),
    title: b.title,
    body: b.body ?? "",
    image_url: b.image_url ?? null,
    audience: b.audience ?? ["all"],
    severity: b.severity ?? "info",
    cta_label: b.cta_label ?? null,
    cta_url: b.cta_url ?? null,
    ctas,
    dismissible: b.dismissible !== false,
    is_active: !!b.is_active,
    sort_order: b.sort_order ?? 0,
    start_date: b.start_date ?? null,
    end_date: b.end_date ?? null,
    createdAt: b.createdAt ?? null,
    updatedAt: b.updatedAt ?? null,
  };
}

/* ─── Public list (guest-visible) ─────────────────────────────────── */

export async function listActiveBanners(req: Request, res: Response) {
  try {
    const audiences = audiencesForCaller(req);
    const now = new Date();
    const rows = await HomeBanner.find({
      is_active: true,
      audience: { $in: audiences },
      $and: [
        { $or: [{ start_date: null }, { start_date: { $lte: now } }] },
        { $or: [{ end_date: null }, { end_date: { $gte: now } }] },
      ],
    })
      .sort({ sort_order: 1, createdAt: -1 })
      .limit(10)
      .lean();
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: rows.map(serialize),
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Admin CRUD ──────────────────────────────────────────────────── */

const SEVERITIES = ["info", "promo", "maintenance", "critical", "success"] as const;
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

export async function adminListBanners(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const page = Math.max(1, parseInt(String(req.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query?.pageSize ?? "20"), 10) || 20)
    );
    const search = String(req.query?.search ?? "").trim();
    const filter: any = {};
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { body: { $regex: search, $options: "i" } },
      ];
    }
    const status = String(req.query?.status ?? "").toLowerCase();
    if (status === "active") filter.is_active = true;
    if (status === "inactive") filter.is_active = false;
    const audience = String(req.query?.audience ?? "").toLowerCase();
    if ((AUDIENCE_VALUES as readonly string[]).includes(audience)) {
      filter.audience = audience;
    }

    const [rows, total] = await Promise.all([
      HomeBanner.find(filter)
        .sort({ sort_order: 1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      HomeBanner.countDocuments(filter),
    ]);
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        items: rows.map(serialize),
        total,
        page,
        pageSize,
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminCreateBanner(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const body = req.body ?? {};
    if (!body.title) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "Title is required." });
    }
    const severity =
      typeof body.severity === "string" &&
      (SEVERITIES as readonly string[]).includes(body.severity)
        ? body.severity
        : "info";
    const created = await HomeBanner.create({
      title: String(body.title).trim(),
      body: String(body.body ?? "").trim(),
      image_url: body.image_url || null,
      audience: sanitizeAudience(body.audience),
      severity,
      cta_label: body.cta_label || null,
      cta_url: body.cta_url || null,
      ctas: sanitizeCtas(body.ctas),
      dismissible: body.dismissible !== false,
      is_active: body.is_active !== false,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      start_date: body.start_date ? new Date(body.start_date) : null,
      end_date: body.end_date ? new Date(body.end_date) : null,
      created_by: (req as any)?.authUser?._id ?? null,
    });
    void notifyCmsUpdated("banners").catch(() => {});
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serialize(created.toObject()) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminUpdateBanner(req: Request, res: Response) {
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
    if (typeof body.body === "string") patch.body = body.body.trim();
    if ("image_url" in body) patch.image_url = body.image_url || null;
    if ("audience" in body) patch.audience = sanitizeAudience(body.audience);
    if (
      typeof body.severity === "string" &&
      (SEVERITIES as readonly string[]).includes(body.severity)
    ) {
      patch.severity = body.severity;
    }
    if ("cta_label" in body) patch.cta_label = body.cta_label || null;
    if ("cta_url" in body) patch.cta_url = body.cta_url || null;
    if ("ctas" in body) patch.ctas = sanitizeCtas(body.ctas);
    if (typeof body.dismissible === "boolean") patch.dismissible = body.dismissible;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if ("start_date" in body)
      patch.start_date = body.start_date ? new Date(body.start_date) : null;
    if ("end_date" in body)
      patch.end_date = body.end_date ? new Date(body.end_date) : null;
    const updated = await HomeBanner.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true }
    ).lean();
    if (!updated) {
      return res
        .status(404)
        .send({ status: CONSTANCE.FAIL, error: "Banner not found." });
    }
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serialize(updated) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminDeleteBanner(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    await HomeBanner.findByIdAndDelete(id);
    void notifyCmsUpdated("banners").catch(() => {});
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminToggleBanner(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const current = await HomeBanner.findById(id).select("is_active").lean();
    if (!current) {
      return res
        .status(404)
        .send({ status: CONSTANCE.FAIL, error: "Banner not found." });
    }
    const updated = await HomeBanner.findByIdAndUpdate(
      id,
      { $set: { is_active: !current.is_active } },
      { new: true }
    ).lean();
    void notifyCmsUpdated("banners").catch(() => {});
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serialize(updated) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
