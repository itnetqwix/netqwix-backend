/** Booking refund lifecycle (booked_sessions.refund_status). */
export const REFUND_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  /** Legacy alias — treat same as completed for idempotency. */
  REFUNDED: "refunded",
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export const REFUND_TRANSFER_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const ESCROW_HOLD_STATUS = {
  HELD: "held",
  RELEASING: "releasing",
  RELEASED: "released",
  REFUNDED: "refunded",
  DISPUTED: "disputed",
  CANCELLED: "cancelled",
} as const;

export function isRefundTerminal(status: string | null | undefined): boolean {
  return (
    status === REFUND_STATUS.COMPLETED ||
    status === REFUND_STATUS.REFUNDED
  );
}
