/**
 * Tips controller (Phase 2 item 5).
 *
 * Public list: returns active, in-window tips filtered by the caller's
 * account_type. Admin CRUD lives in the same file to keep the surface
 * small — `assertAdminUser` gates every mutation.
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import { CONSTANCE } from "../../config/constance";
import Tip from "../../model/tip.schema";
import { assertAdminUser } from "../admin/adminPermission";

function adminDenied(req: Request): string | null {
  return assertAdminUser((req as any)?.authUser);
}

function audienceForAccountType(accountType?: string | null): string[] {
  const at = String(accountType ?? "").toLowerCase();
  if (at === "trainer") return ["all", "trainer"];
  if (at === "trainee") return ["all", "trainee"];
  return ["all"];
}

function serialize(t: any) {
  return {
    _id: String(t._id),
    title: t.title,
    body: t.body,
    image_url: t.image_url ?? null,
    icon: t.icon ?? null,
    audience: t.audience,
    cta_label: t.cta_label ?? null,
    cta_url: t.cta_url ?? null,
    sort_order: t.sort_order ?? 0,
    is_active: !!t.is_active,
    start_date: t.start_date ?? null,
    end_date: t.end_date ?? null,
    createdAt: t.createdAt ?? null,
    updatedAt: t.updatedAt ?? null,
  };
}

/* ─── Public ─────────────────────────────────────────────────────── */

export async function listActiveTips(req: Request, res: Response) {
  try {
    const accountType = (req as any)?.authUser?.account_type;
    const audiences = audienceForAccountType(accountType);
    const now = new Date();
    const rows = await Tip.find({
      is_active: true,
      audience: { $in: audiences },
      $and: [
        { $or: [{ start_date: null }, { start_date: { $lte: now } }] },
        { $or: [{ end_date: null }, { end_date: { $gte: now } }] },
      ],
    })
      .sort({ sort_order: 1, createdAt: -1 })
      .limit(20)
      .lean();
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: rows.map(serialize),
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

/* ─── Admin CRUD ─────────────────────────────────────────────────── */

export async function adminListTips(req: Request, res: Response) {
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
    if (["all", "trainer", "trainee"].includes(audience)) filter.audience = audience;

    const [rows, total] = await Promise.all([
      Tip.find(filter)
        .sort({ sort_order: 1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Tip.countDocuments(filter),
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

export async function adminCreateTip(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const body = req.body ?? {};
    if (!body.title || !body.body) {
      return res.status(400).send({
        status: CONSTANCE.FAIL,
        error: "Title and body are required.",
      });
    }
    const created = await Tip.create({
      title: String(body.title).trim(),
      body: String(body.body).trim(),
      image_url: body.image_url || null,
      icon: body.icon || null,
      audience: ["all", "trainer", "trainee"].includes(body.audience)
        ? body.audience
        : "all",
      cta_label: body.cta_label || null,
      cta_url: body.cta_url || null,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      is_active: body.is_active !== false,
      start_date: body.start_date ? new Date(body.start_date) : null,
      end_date: body.end_date ? new Date(body.end_date) : null,
      created_by: (req as any)?.authUser?._id ?? null,
    });
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: serialize(created.toObject()) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminUpdateTip(req: Request, res: Response) {
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
    if ("icon" in body) patch.icon = body.icon || null;
    if (["all", "trainer", "trainee"].includes(body.audience)) patch.audience = body.audience;
    if ("cta_label" in body) patch.cta_label = body.cta_label || null;
    if ("cta_url" in body) patch.cta_url = body.cta_url || null;
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if ("start_date" in body)
      patch.start_date = body.start_date ? new Date(body.start_date) : null;
    if ("end_date" in body)
      patch.end_date = body.end_date ? new Date(body.end_date) : null;
    const updated = await Tip.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Tip not found." });
    }
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serialize(updated) });
  } catch (err: any) {
    return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminDeleteTip(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    await Tip.findByIdAndDelete(id);
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminToggleTip(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const current = await Tip.findById(id).select("is_active").lean();
    if (!current) {
      return res.status(404).send({ status: CONSTANCE.FAIL, error: "Tip not found." });
    }
    const updated = await Tip.findByIdAndUpdate(
      id,
      { $set: { is_active: !current.is_active } },
      { new: true }
    ).lean();
    return res.status(200).send({ status: CONSTANCE.SUCCESS, data: serialize(updated) });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
