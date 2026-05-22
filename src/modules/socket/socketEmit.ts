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
