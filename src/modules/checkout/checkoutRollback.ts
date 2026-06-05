/**
 * Compensating wallet actions after failed booking/extension persistence.
 */

export async function rollbackWalletBookingPayment(params: {
  sessionId: string;
  traineeId: string;
  idempotencyKey: string;
  reason: string;
}): Promise<void> {
  const { walletPaymentService } = require("../wallet/walletPaymentService");
  await walletPaymentService.refundWalletPaymentForSession({
    sessionId: params.sessionId,
    traineeId: params.traineeId,
    kind: "booking",
    idempotencyKey: params.idempotencyKey,
    reason: params.reason,
  });
}

export async function rollbackWalletExtensionPayment(params: {
  sessionId: string;
  traineeId: string;
  idempotencyKey: string;
  reason: string;
}): Promise<void> {
  const { walletPaymentService } = require("../wallet/walletPaymentService");
  await walletPaymentService.refundWalletPaymentForSession({
    sessionId: params.sessionId,
    traineeId: params.traineeId,
    kind: "extension",
    idempotencyKey: params.idempotencyKey,
    reason: params.reason,
  });
}
