/**
 * Admin queue for the 15-day soft-delete window.
 *
 *   GET  /admin/account-deletions          — list, optional ?status, ?search
 *   POST /admin/account-deletions/:id/restore  — restore the account
 *   POST /admin/account-deletions/:id/notes    — add admin notes
 */

import { Request, Response } from "express";
import { Types } from "mongoose";
import { CONSTANCE } from "../../config/constance";
import AccountDeletionRequest from "../../model/account_deletion_request.schema";
import { assertAdminUser } from "./adminPermission";
import { accountDeletionService } from "../user/accountDeletionService";

function adminDenied(req: Request): string | null {
  return assertAdminUser((req as any)?.authUser);
}

function serialize(row: any) {
  return {
    _id: String(row._id),
    user_id: String(row.user_id ?? ""),
    user_email_at_request: row.user_email_at_request ?? null,
    user_fullname_at_request: row.user_fullname_at_request ?? null,
    reason: row.reason ?? null,
    feedback_category: row.feedback_category ?? null,
    status: row.status,
    confirmed_at: row.confirmed_at ?? null,
    restore_deadline: row.restore_deadline ?? null,
    hard_deleted_at: row.hard_deleted_at ?? null,
    restored_at: row.restored_at ?? null,
    restored_by: row.restored_by ? String(row.restored_by) : null,
    cancelled_at: row.cancelled_at ?? null,
    admin_notes: row.admin_notes ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function adminListAccountDeletions(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const page = Math.max(1, parseInt(String(req.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query?.pageSize ?? "20"), 10) || 20)
    );
    const search = String(req.query?.search ?? "").trim();
    const status = String(req.query?.status ?? "").toLowerCase();
    const filter: any = {};
    if (
      ["pending", "confirmed", "restored", "hard_deleted", "cancelled"].includes(status)
    ) {
      filter.status = status;
    }
    if (search) {
      filter.$or = [
        { user_email_at_request: { $regex: search, $options: "i" } },
        { user_fullname_at_request: { $regex: search, $options: "i" } },
        { reason: { $regex: search, $options: "i" } },
      ];
    }
    const [rows, total] = await Promise.all([
      AccountDeletionRequest.find(filter)
        .sort({ confirmed_at: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AccountDeletionRequest.countDocuments(filter),
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

export async function adminRestoreAccountDeletion(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const adminId = String((req as any)?.authUser?._id ?? "");
    const note = req.body?.note ? String(req.body.note) : undefined;
    const rb = await accountDeletionService.adminRestore(adminId, id, note);
    return res.status(rb.code).send({
      status: rb.status,
      data: rb.result ?? undefined,
      message: rb.msg ?? undefined,
      error: rb.error ?? undefined,
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function adminAddAccountDeletionNote(req: Request, res: Response) {
  try {
    const denied = adminDenied(req);
    if (denied) return res.status(403).send({ status: CONSTANCE.FAIL, error: denied });
    const id = String(req.params?.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid id." });
    }
    const note = String(req.body?.note ?? "").trim();
    if (!note) {
      return res
        .status(400)
        .send({ status: CONSTANCE.FAIL, error: "Note is required." });
    }
    const updated = await AccountDeletionRequest.findByIdAndUpdate(
      id,
      { $set: { admin_notes: note.slice(0, 600) } },
      { new: true }
    ).lean();
    return res
      .status(200)
      .send({ status: CONSTANCE.SUCCESS, data: updated ? serialize(updated) : null });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
