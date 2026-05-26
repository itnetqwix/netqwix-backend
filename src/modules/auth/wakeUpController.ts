/**
 * Hibernation wake-up endpoints (public — no auth header needed,
 * because hibernated users are locked out of login).
 *
 *   POST /auth/wake-up/start   — body: { contact, channel? }
 *   POST /auth/wake-up/confirm — body: { accountId, code }
 */

import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { hibernationService } from "../user/hibernationService";

function sendRb(res: Response, rb: any) {
  return res.status(rb?.code ?? 200).send({
    status: rb?.status,
    data: rb?.result ?? undefined,
    message: rb?.msg ?? undefined,
    error: rb?.error ?? undefined,
  });
}

export async function startWakeUp(req: Request, res: Response) {
  try {
    const { contact, channel } = req.body ?? {};
    const rb = await hibernationService.startWakeUp(
      String(contact ?? ""),
      channel === "sms" ? "sms" : "email"
    );
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}

export async function confirmWakeUp(req: Request, res: Response) {
  try {
    const { accountId, code } = req.body ?? {};
    const rb = await hibernationService.confirmWakeUp(
      String(accountId ?? ""),
      String(code ?? "")
    );
    return sendRb(res, rb);
  } catch (err: any) {
    return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
  }
}
