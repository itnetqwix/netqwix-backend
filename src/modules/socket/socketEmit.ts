/**
 * Cluster-safe Socket.IO targeting via named rooms (`user:{id}`, `session:{id}`).
 * Clients join `user:{userId}` on connect (see `init.ts`).
 */

let boundIo: import("socket.io").Server | null = null;

export function bindSocketIo(io: import("socket.io").Server): void {
  boundIo = io;
}

export function getBoundSocketIo(): import("socket.io").Server | null {
  return boundIo;
}

export function userRoom(userId: string): string {
  return `user:${String(userId)}`;
}

export function sessionRoom(sessionId: string): string {
  return `session:${String(sessionId)}`;
}

export function chatRoom(conversationId: string): string {
  return `chat:${String(conversationId)}`;
}

export function emitToUser(
  userId: string | null | undefined,
  event: string,
  payload: unknown
): boolean {
  if (!userId || !boundIo) return false;
  boundIo.to(userRoom(userId)).emit(event, payload);
  return true;
}

export function emitToUsers(
  userIds: Array<string | null | undefined>,
  event: string,
  payload: unknown
): void {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id) continue;
    const uid = String(id);
    if (seen.has(uid)) continue;
    seen.add(uid);
    emitToUser(uid, event, payload);
  }
}

export function emitToSession(
  sessionId: string,
  event: string,
  payload: unknown
): boolean {
  if (!sessionId || !boundIo) return false;
  boundIo.to(sessionRoom(sessionId)).emit(event, payload);
  return true;
}

/**
 * Cluster-safe publish: Redis pub/sub → every API instance delivers via Socket.IO.
 * Prefer this from HTTP services, cron, and BullMQ workers.
 */
export async function publishSocketEvent(
  target: import("../../services/eventPubSub").SocketDeliveryTarget,
  event: string,
  payload: unknown
): Promise<void> {
  const { publishSocketEvent: pub } = await import("../../services/eventPubSub");
  await pub(target, event, payload);
}

export function publishSocketEventToUser(
  userId: string,
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEvent({ kind: "user", userId: String(userId) }, event, payload);
}

export function publishSocketEventToUsers(
  userIds: string[],
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEvent(
    { kind: "users", userIds: userIds.map(String) },
    event,
    payload
  );
}

export function publishSocketEventToSession(
  sessionId: string,
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEvent(
    { kind: "session", sessionId: String(sessionId) },
    event,
    payload
  );
}

export function publishSocketEventToRoom(
  room: string,
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEvent({ kind: "room", room: String(room) }, event, payload);
}

export function publishSocketEventToChat(
  conversationId: string,
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEventToRoom(chatRoom(conversationId), event, payload);
}

export function publishSocketBroadcast(
  event: string,
  payload: unknown
): Promise<void> {
  return publishSocketEvent({ kind: "broadcast" }, event, payload);
}
