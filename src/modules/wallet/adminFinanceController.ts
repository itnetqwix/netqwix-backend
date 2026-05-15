import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { ledgerService } from "./ledgerService";
import { escrowService } from "./escrowService";
import { payoutService } from "./payoutService";
import { releaseService } from "./releaseService";
import { walletAccountService } from "./walletAccountService";
import mongoose from "mongoose";
import { financialAuditService } from "./financialAuditService";
import financial_audit_log from "../../model/financial_audit_log.schema";

export class AdminFinanceController {
  public getLedger = async (req: Request, res: Response) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const userId = req.query.userId as string | undefined;
      const walletAccountId = req.query.walletAccountId as string | undefined;
      const result = await ledgerService.listEntries({
        userId,
        walletAccountId,
        page,
        limit,
        referenceType: req.query.referenceType as string | undefined,
      });
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getEscrowHolds = async (req: Request, res: Response) => {
    try {
      const filter: Record<string, unknown> = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.sessionId) filter.session_id = req.query.sessionId;
      const result = await escrowService.listHolds(
        filter,
        Number(req.query.page) || 1,
        Number(req.query.limit) || 50
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public releaseEscrow = async (req: Request, res: Response) => {
    try {
      const hold = await releaseService.releaseHold(
        req.params.holdId,
        req.body.reason || "admin_manual_release",
        String(req["authUser"]?._id)
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: hold });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public refundEscrow = async (req: Request, res: Response) => {
    try {
      const hold = await releaseService.refundHold(
        req.params.holdId,
        req.body.reason || "admin_refund",
        String(req["authUser"]?._id)
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: hold });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getPayoutQueue = async (req: Request, res: Response) => {
    try {
      const filter: Record<string, unknown> = {};
      if (req.query.status) filter.status = req.query.status;
      const result = await payoutService.listPayouts(
        filter,
        Number(req.query.page) || 1,
        Number(req.query.limit) || 50
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public approvePayout = async (req: Request, res: Response) => {
    try {
      const adminId = String(req["authUser"]?._id);
      const result = await payoutService.approvePayout(
        req.params.payoutId,
        adminId,
        req.body.second_admin_id
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public adjustWallet = async (req: Request, res: Response) => {
    try {
      const { walletAccountId, amount_minor, direction, reason, second_admin_id } = req.body;
      const adminId = String(req["authUser"]?._id);
      const amount = Math.abs(Number(amount_minor));
      if (amount >= 10000 && !second_admin_id) {
        return res.status(400).send({
          status: CONSTANCE.FAIL,
          error: "Dual admin approval required for adjustments >= $100",
        });
      }

      const platform = await walletAccountService.getOrCreatePlatformAccount();
      const isCredit = direction === "credit";

      await ledgerService.post({
        idempotencyKey: `admin:adjust:${walletAccountId}:${Date.now()}`,
        referenceType: "adjustment",
        referenceId: walletAccountId,
        actor: "admin",
        actorUserId: adminId,
        metadata: { reason, second_admin_id },
        legs: [
          {
            walletAccountId: new mongoose.Types.ObjectId(walletAccountId),
            bucket: "available",
            entryType: isCredit ? "credit" : "debit",
            amountMinor: amount,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(String(platform._id)),
            bucket: "available",
            entryType: isCredit ? "debit" : "credit",
            amountMinor: amount,
          },
        ],
      });

      await financialAuditService.log({
        action: "wallet_admin_adjustment",
        entity_type: "wallet_account",
        entity_id: walletAccountId,
        admin_id: adminId as any,
        amount_minor: amount,
        reason,
        meta: { direction, second_admin_id },
      });

      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getFinancialAuditLog = async (req: Request, res: Response) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(100, Number(req.query.limit) || 50);
      const filter: Record<string, unknown> = {};
      if (req.query.action) filter.action = req.query.action;
      const [items, total] = await Promise.all([
        financial_audit_log
          .find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        financial_audit_log.countDocuments(filter),
      ]);
      return res
        .status(200)
        .send({ status: CONSTANCE.SUCCESS, data: { items, total, page, limit } });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };
}

export const adminFinanceController = new AdminFinanceController();
