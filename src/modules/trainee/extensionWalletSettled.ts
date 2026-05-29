import escrow_holds from "../../model/escrow_holds.schema";
import wallet_ledger_entries from "../../model/wallet_ledger_entries.schema";

export function extensionWalletIdempotencyKey(
  sessionId: string,
  requestId: string
): string {
  return `ext:wallet:${sessionId}:${requestId}`;
}

/** True when wallet debit / escrow hold exists for this extension request. */
export async function isExtensionWalletSettled(
  sessionId: string,
  requestId: string
): Promise<boolean> {
  const idempotencyKey = extensionWalletIdempotencyKey(sessionId, requestId);
  const hold = await escrow_holds
    .findOne({
      session_id: sessionId,
      kind: "extension",
      idempotency_key: idempotencyKey,
    })
    .lean();
  if (hold && ["held", "released", "disputed", "refunded"].includes(String(hold.status))) {
    return true;
  }
  const ledger = await wallet_ledger_entries
    .findOne({ idempotency_key: idempotencyKey })
    .lean();
  return !!ledger;
}
