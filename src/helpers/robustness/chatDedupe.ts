/** Mongo filter for client send dedupe (same sender + clientMessageId). */
export function chatClientSendDedupeFilter(
  clientMessageId: string,
  senderId: string
): { clientMessageId: string; senderId: string } {
  return { clientMessageId, senderId };
}
