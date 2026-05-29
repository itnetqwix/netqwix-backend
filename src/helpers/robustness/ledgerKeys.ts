/** First ledger leg idempotency key — duplicate posts short-circuit on this row. */
export function ledgerFirstLegIdempotencyKey(idempotencyKey: string): string {
  return `${idempotencyKey}:0`;
}

export function ledgerLegIdempotencyKey(idempotencyKey: string, legIndex: number): string {
  return `${idempotencyKey}:${legIndex}`;
}
