import * as crypto from "crypto";
import mongoose from "mongoose";
import wallet_accounts from "../../model/wallet_accounts.schema";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";
import { WALLET_CONFIG, WalletBucket } from "../../config/wallet";
import { financialAuditService } from "./financialAuditService";
import type { LedgerReferenceType } from "../../config/wallet";

export type PostingLeg = {
  walletAccountId: mongoose.Types.ObjectId;
  bucket: WalletBucket;
  entryType: "credit" | "debit";
  amountMinor: number;
};

export type PostingRequest = {
  idempotencyKey: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  sessionId?: string;
  legs: PostingLeg[];
  actor?: "user" | "system" | "admin" | "webhook";
  actorUserId?: string;
  metadata?: Record<string, unknown>;
};

export class LedgerService {
  async getBalance(
    walletAccountId: mongoose.Types.ObjectId | string,
    bucket: WalletBucket = "available"
  ): Promise<number> {
    const account = await wallet_accounts.findById(walletAccountId).lean();
    if (account?.balance_cache) {
      const cached = (account.balance_cache as Record<string, number>)[bucket];
      if (typeof cached === "number") return cached;
    }
    return this.computeBalance(walletAccountId, bucket);
  }

  async computeBalance(
    walletAccountId: mongoose.Types.ObjectId | string,
    bucket: WalletBucket
  ): Promise<number> {
    const rows = await wallet_ledger_entries.aggregate([
      {
        $match: {
          wallet_account_id: new mongoose.Types.ObjectId(String(walletAccountId)),
          bucket,
        },
      },
      {
        $group: {
          _id: null,
          credits: {
            $sum: {
              $cond: [{ $eq: ["$entry_type", "credit"] }, "$amount_minor", 0],
            },
          },
          debits: {
            $sum: {
              $cond: [{ $eq: ["$entry_type", "debit"] }, "$amount_minor", 0],
            },
          },
        },
      },
    ]);
    const credits = rows[0]?.credits ?? 0;
    const debits = rows[0]?.debits ?? 0;
    return credits - debits;
  }

  async refreshBalanceCache(walletAccountId: mongoose.Types.ObjectId | string) {
    const buckets: WalletBucket[] = [
      "available",
      "pending_topup",
      "escrow_held",
      "pending_release",
      "pending_payout",
    ];
    const cache: Record<string, number> = {};
    for (const b of buckets) {
      cache[b] = await this.computeBalance(walletAccountId, b);
    }
    await wallet_accounts.findByIdAndUpdate(walletAccountId, {
      $set: { balance_cache: cache },
    });
    return cache;
  }

  /** Double-entry posting; legs must balance (sum credits === sum debits). */
  async post(request: PostingRequest): Promise<{ entryIds: string[]; idempotent: boolean }> {
    const existing = await wallet_ledger_entries
      .findOne({ idempotency_key: request.idempotencyKey })
      .lean();
    if (existing) {
      const siblings = await wallet_ledger_entries
        .find({ reference_id: request.referenceId, reference_type: request.referenceType })
        .select("entry_id")
        .lean();
      return {
        entryIds: siblings.map((s) => s.entry_id),
        idempotent: true,
      };
    }

    const totalCredits = request.legs
      .filter((l) => l.entryType === "credit")
      .reduce((s, l) => s + l.amountMinor, 0);
    const totalDebits = request.legs
      .filter((l) => l.entryType === "debit")
      .reduce((s, l) => s + l.amountMinor, 0);
    if (totalCredits !== totalDebits || totalCredits <= 0) {
      throw new Error("Ledger posting must balance with positive amount.");
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const entryIds: string[] = [];
      const pairGroup = crypto.randomUUID();
      const docs = request.legs.map((leg, idx) => {
        const entryId = `${pairGroup}-${idx}`;
        entryIds.push(entryId);
        return {
          entry_id: entryId,
          idempotency_key: `${request.idempotencyKey}:${idx}`,
          wallet_account_id: leg.walletAccountId,
          entry_type: leg.entryType,
          bucket: leg.bucket,
          amount_minor: leg.amountMinor,
          counterparty_entry_id: pairGroup,
          reference_type: request.referenceType,
          reference_id: request.referenceId,
          session_id: request.sessionId
            ? new mongoose.Types.ObjectId(request.sessionId)
            : undefined,
          metadata: request.metadata,
          actor: request.actor ?? "system",
          actor_user_id: request.actorUserId
            ? new mongoose.Types.ObjectId(request.actorUserId)
            : undefined,
        };
      });

      const touched = new Set<string>();
      for (const leg of request.legs) {
        const id = String(leg.walletAccountId);
        if (touched.has(id)) continue;
        touched.add(id);
        const debitSum = request.legs
          .filter(
            (l) =>
              String(l.walletAccountId) === id &&
              l.bucket === "available" &&
              l.entryType === "debit"
          )
          .reduce((s, l) => s + l.amountMinor, 0);
        if (debitSum > 0) {
          const bal = await this.computeBalance(leg.walletAccountId, "available");
          if (bal < debitSum) {
            throw new Error("Insufficient wallet balance.");
          }
        }
      }

      await wallet_ledger_entries.insertMany(docs, { session });

      for (const id of touched) {
        await this.refreshBalanceCache(id);
      }

      await session.commitTransaction();

      await financialAuditService.log({
        action: `ledger_${request.referenceType}`,
        entity_type: "ledger_posting",
        entity_id: request.referenceId,
        user_id: request.actorUserId as any,
        meta: { entryIds, idempotencyKey: request.idempotencyKey },
        idempotency_key: request.idempotencyKey,
      });

      return { entryIds, idempotent: false };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async listEntries(params: {
    walletAccountId?: string;
    userId?: string;
    page?: number;
    limit?: number;
    referenceType?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, params.limit ?? 25);
    const filter: Record<string, unknown> = {};
    if (params.walletAccountId) {
      filter.wallet_account_id = new mongoose.Types.ObjectId(params.walletAccountId);
    } else if (params.userId) {
      const accounts = await wallet_accounts.find({ user_id: params.userId }).select("_id").lean();
      filter.wallet_account_id = { $in: accounts.map((a) => a._id) };
    }
    if (params.referenceType) filter.reference_type = params.referenceType;

    const [items, total] = await Promise.all([
      wallet_ledger_entries
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      wallet_ledger_entries.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}

export const ledgerService = new LedgerService();
