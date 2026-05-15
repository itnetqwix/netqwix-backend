import * as crypto from "crypto";
import mongoose from "mongoose";
import { WALLET_CONFIG, isRegionWalletEnabled } from "../../config/wallet";
import { walletAccountService } from "./walletAccountService";
import { ledgerService } from "./ledgerService";
import { escrowService } from "./escrowService";
import { pinService } from "./pinService";
import wallet_accounts from "../../model/wallet_accounts.schema";

export class WalletPaymentService {
  dollarsToMinor(amount: number) {
    return Math.round(amount * 100);
  }

  async payFromWallet(params: {
    traineeId: string;
    sessionId: string;
    trainerId: string;
    amountDollars: number;
    pinSessionToken?: string;
    kind: "extension" | "booking";
    idempotencyKey?: string;
  }) {
    if (!WALLET_CONFIG.walletPayEnabled || !isRegionWalletEnabled(undefined, "walletPay")) {
      throw new Error("Wallet payments are not enabled.");
    }

    const amountMinor = this.dollarsToMinor(params.amountDollars);
    if (amountMinor <= 0) {
      return { paid: true, amountMinor: 0, fundingSource: "wallet" as const };
    }

    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId: params.traineeId,
      accountType: "trainee",
    });

    if (wallet.status === "frozen") {
      throw new Error("Wallet is frozen.");
    }

    if (amountMinor >= WALLET_CONFIG.stepUpThresholdMinor) {
      if (!params.pinSessionToken) {
        throw new Error("PIN verification required for this amount.");
      }
      const session = pinService.verifyPinSessionToken(params.pinSessionToken);
      if (session.userId !== params.traineeId || session.walletAccountId !== String(wallet._id)) {
        throw new Error("Invalid PIN session.");
      }
    }

    const available = await ledgerService.getBalance(wallet._id, "available");
    if (available < amountMinor) {
      throw new Error("Insufficient wallet balance.");
    }

    const idempotencyKey =
      params.idempotencyKey ??
      `walletpay:${params.kind}:${params.sessionId}:${crypto.randomUUID()}`;

    if (WALLET_CONFIG.escrowEnabled) {
      await escrowService.createHold({
        sessionId: params.sessionId,
        traineeId: params.traineeId,
        trainerId: params.trainerId,
        grossMinor: amountMinor,
        platformFeeMinor: 0,
        fundingSource: "wallet",
        kind: params.kind,
        idempotencyKey,
      });
    } else {
      await ledgerService.post({
        idempotencyKey,
        referenceType: params.kind === "extension" ? "extension" : "booking",
        referenceId: params.sessionId,
        sessionId: params.sessionId,
        actor: "user",
        actorUserId: params.traineeId,
        legs: [
          {
            walletAccountId: new mongoose.Types.ObjectId(String(wallet._id)),
            bucket: "available",
            entryType: "debit",
            amountMinor,
          },
          {
            walletAccountId: new mongoose.Types.ObjectId(
              String((await walletAccountService.getOrCreatePlatformAccount())._id)
            ),
            bucket: "available",
            entryType: "credit",
            amountMinor,
          },
        ],
      });
    }

    return {
      paid: true,
      amountMinor,
      fundingSource: "wallet" as const,
      idempotencyKey,
    };
  }

  async getBalanceSummary(userId: string, accountType: "trainee" | "trainer") {
    const wallet = await walletAccountService.getOrCreateUserWallet({
      userId,
      accountType,
    });
    const walletDoc = await wallet_accounts
      .findById(wallet._id)
      .select("pin_set_at payout_preference status currency")
      .lean();
    const cache = await ledgerService.refreshBalanceCache(wallet._id);
    return {
      walletAccountId: wallet._id,
      currency: wallet.currency,
      status: wallet.status,
      pinSet: !!walletDoc?.pin_set_at,
      payoutPreference: walletDoc?.payout_preference ?? wallet.payout_preference,
      balances: {
        available: cache.available / 100,
        available_minor: cache.available,
        pending_topup: cache.pending_topup / 100,
        pending_release: cache.pending_release / 100,
        pending_payout: cache.pending_payout / 100,
      },
    };
  }
}

export const walletPaymentService = new WalletPaymentService();
