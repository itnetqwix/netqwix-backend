/**
 * Account-lifecycle endpoints (Phase 2 items 15 + 16).
 *
 *   POST /user/me/deletion/request   — password + reason → OTP sent
 *   POST /user/me/deletion/confirm   — OTP → freeze + 15d restore window
 *   POST /user/me/deletion/cancel    — clear pending (used by recovery flows)
 *   POST /user/me/hibernate/request  — OTP sent
 *   POST /user/me/hibernate/confirm  — OTP → hibernate + revoke sessions
 *   GET  /user/me/lifecycle          — current state ({ pendingDeletion, hibernated })
 */

import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import user from "../../model/user.schema";
import AccountDeletionRequest from "../../model/account_deletion_request.schema";
import { accountDeletionService } from "./accountDeletionService";
import { hibernationService } from "./hibernationService";

function senderId(req: Request): string {
  return String((req as any)?.authUser?._id ?? "");
}

function sendRb(res: Response, rb: any) {
  const code = rb?.code ?? 200;
  return res.status(code).send({
    status: rb?.status,
    data: rb?.result ?? undefined,
    message: rb?.msg ?? undefined,
    error: rb?.error ?? undefined,
  });
}

export async function requestAccountDeletion(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const { password, reason, feedback_category, channel } = req.body ?? {};
    const rb = await accountDeletionService.requestDeletion(
      userId,
      String(password ?? ""),
      reason ? String(reason) : undefined,
      feedback_category ? String(feedback_category) : undefined,
      channel === "sms" ? "sms" : "email"
    );
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function confirmAccountDeletion(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const { code, reason } = req.body ?? {};
    const rb = await accountDeletionService.confirmDeletion(
      userId,
      String(code ?? ""),
      reason ? String(reason) : undefined
    );
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function cancelAccountDeletion(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const rb = await accountDeletionService.cancelOwnPendingDeletion(userId);
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function requestHibernate(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const channel = req.body?.channel === "sms" ? "sms" : "email";
    const rb = await hibernationService.enterHibernate(userId, channel);
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function confirmHibernate(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const { code, reason } = req.body ?? {};
    const rb = await hibernationService.confirmHibernate(
      userId,
      String(code ?? ""),
      reason ? String(reason) : undefined
    );
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function getLifecycleState(req: Request, res: Response) {
  try {
    const userId = senderId(req);
    const u = await user
      .findById(userId)
      .select("pending_deletion_at hibernated_at hibernated_reason deleted_at")
      .lean();
    const pending = await AccountDeletionRequest.findOne({
      user_id: userId,
      status: "confirmed",
    })
      .sort({ confirmed_at: -1 })
      .lean();
    const restoreDeadline = pending?.restore_deadline ?? null;
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        deleted: !!u?.deleted_at,
        hibernated: !!u?.hibernated_at,
        hibernatedAt: u?.hibernated_at
          ? new Date(u.hibernated_at).toISOString()
          : null,
        hibernatedReason: u?.hibernated_reason ?? null,
        pendingDeletion: !!u?.pending_deletion_at,
        pendingDeletionAt: u?.pending_deletion_at
          ? new Date(u.pending_deletion_at).toISOString()
          : null,
        restoreDeadline: restoreDeadline
          ? new Date(restoreDeadline).toISOString()
          : null,
      },
    });
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
