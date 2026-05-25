import { Request, Response } from "express";
import { CONSTANCE } from "../../config/constance";
import { WALLET_CONFIG } from "../../config/wallet";
import { topUpService } from "./topUpService";
import { pinService } from "./pinService";
import { walletPaymentService } from "./walletPaymentService";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { payoutService } from "./payoutService";
import { walletTransactionDetailService } from "./walletTransactionDetailService";
import { savedPaymentMethodsService } from "./savedPaymentMethodsService";
import { autoTopUpService } from "./autoTopUpService";
import { walletTimelineService } from "./walletTimelineService";
import { AccountType } from "../auth/authEnum";

export class WalletController {
  public getBalance = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const accountType =
        req["authUser"]?.account_type === AccountType.TRAINER ? "trainer" : "trainee";
      const summary = await walletPaymentService.getBalanceSummary(userId, accountType);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: summary });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getTransactionDetail = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const entryId = String(req.params.id);
      const detail = await walletTransactionDetailService.getLedgerDetail(userId, entryId);
      if (!detail) {
        return res.status(404).send({ status: CONSTANCE.FAIL, error: "Transaction not found." });
      }
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: detail });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getLedger = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 25;
      const result = await ledgerService.listEntries({ userId, page, limit });
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public createTopUpIntent = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const amountMinor = Number(req.body.amount_minor ?? req.body.amountMinor);
      const accountType =
        req["authUser"]?.account_type === AccountType.TRAINER ? "trainer" : "trainee";
      const result = await topUpService.createTopUpIntent({
        userId,
        amountMinor,
        region: req.body.region,
        accountType,
      });
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ status: CONSTANCE.FAIL, error: result.error });
      }
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getTopUpStatus = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const topupId = String(req.params.topupId);
      const result = await topUpService.getTopUpStatus(userId, topupId);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ status: CONSTANCE.FAIL, error: result.error });
      }
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public confirmTopUp = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const topupId = String(req.params.topupId);
      const result = await topUpService.confirmTopUpFromClient(userId, topupId);
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ status: CONSTANCE.FAIL, error: result.error });
      }
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public setPin = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId,
        accountType: "trainee",
      });
      await pinService.setPin(userId, String(wallet._id), req.body.pin);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public verifyPin = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId,
        accountType: "trainee",
      });
      const result = await pinService.verifyPin(userId, String(wallet._id), req.body.pin);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public forgotPinRequest = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId,
        accountType: "trainee",
      });
      const result = await pinService.requestPinReset(userId, String(wallet._id));
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public forgotPinConfirm = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const wallet = await walletAccountService.getOrCreateUserWallet({
        userId,
        accountType: "trainee",
      });
      await pinService.confirmPinReset(
        userId,
        String(wallet._id),
        req.body.new_pin,
        req.body.reset_token
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public updatePayoutPreference = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const pref = req.body.preference;
      if (!["wallet_fast", "bank_standard"].includes(pref)) {
        return res.status(400).send({ status: CONSTANCE.FAIL, error: "Invalid preference" });
      }
      const updated = await walletAccountService.updatePayoutPreference(userId, pref);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: updated });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public requestWithdraw = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const amountMinor = Number(req.body.amount_minor);
      const method = req.body.method === "bank" ? "bank" : "wallet_internal";
      const reqDoc = await payoutService.requestWithdrawal({
        trainerId: userId,
        amountMinor,
        method,
        pinSessionToken: req.body.pin_session_token,
      });
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: reqDoc });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getEarnings = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const summary = await walletPaymentService.getBalanceSummary(userId, "trainer");
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: summary });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getTrainerPulse = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const data = await walletPaymentService.getTrainerPulse(userId);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getTrainerEarningsSeries = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const range = String(req.query?.range ?? "weekly");
      const data = await walletPaymentService.getTrainerEarningsSeries(
        userId,
        range === "monthly" ? "monthly" : "weekly"
      );
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public exportTrainerEarningsCsv = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const range = String(req.query?.range ?? "monthly");
      const csv = await walletPaymentService.exportTrainerEarningsCsv(
        userId,
        range === "weekly" ? "weekly" : "monthly"
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="netqwix-earnings-${range}.csv"`
      );
      return res.status(200).send(csv);
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public listPaymentMethods = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const items = await savedPaymentMethodsService.list(userId);
      return res
        .status(200)
        .send({ status: CONSTANCE.SUCCESS, data: { items } });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public deletePaymentMethod = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const pmId = String(req.params.id);
      await savedPaymentMethodsService.detach(userId, pmId);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public makePaymentMethodDefault = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const pmId = String(req.params.id);
      await savedPaymentMethodsService.makeDefault(userId, pmId);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getAutoTopUp = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const rule = await autoTopUpService.getForUser(userId);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: rule });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public saveAutoTopUp = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const body = req.body || {};
      const result = await autoTopUpService.upsertForUser(userId, {
        enabled: body.enabled,
        thresholdMinor: body.thresholdMinor ?? body.threshold_minor,
        reloadMinor: body.reloadMinor ?? body.reload_minor,
        paymentMethodId: body.paymentMethodId ?? body.payment_method_id,
      });
      if (result.status === CONSTANCE.FAIL) {
        return res.status(result.code).send({ status: CONSTANCE.FAIL, error: result.error });
      }
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: result.result });
    } catch (err: any) {
      return res.status(400).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public disableAutoTopUp = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      await autoTopUpService.disable(userId);
      return res.status(200).send({ status: CONSTANCE.SUCCESS, data: { ok: true } });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getTransactionTimeline = async (req: Request, res: Response) => {
    try {
      const userId = String(req["authUser"]?._id);
      const id = String(req.params.id);
      const events = await walletTimelineService.getForLedgerEntry(userId, id);
      const detail = await walletTransactionDetailService.getLedgerDetail(userId, id);
      return res.status(200).send({
        status: CONSTANCE.SUCCESS,
        data: {
          events,
          currency: (detail as any)?.currency ?? WALLET_CONFIG.defaultCurrency,
        },
      });
    } catch (err: any) {
      return res.status(500).send({ status: CONSTANCE.FAIL, error: err.message });
    }
  };

  public getConfig = async (_req: Request, res: Response) => {
    return res.status(200).send({
      status: CONSTANCE.SUCCESS,
      data: {
        enabled: WALLET_CONFIG.enabled,
        escrowEnabled: WALLET_CONFIG.escrowEnabled,
        walletPayEnabled: WALLET_CONFIG.walletPayEnabled,
        minTopUpMinor: WALLET_CONFIG.minTopUpMinor,
        maxTopUpMinor: WALLET_CONFIG.maxTopUpMinor,
        stepUpThresholdMinor: WALLET_CONFIG.stepUpThresholdMinor,
        regionCurrency: WALLET_CONFIG.regionCurrency,
      },
    });
  };
}

export const walletController = new WalletController();
