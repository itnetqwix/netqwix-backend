/** Late-bound Socket.IO instance — avoids circular imports with socket.service. */
let resolveIo: (() => import("socket.io").Server | null) | null = null;

export function bindLessonCallSlotIo(getter: () => import("socket.io").Server | null): void {
  resolveIo = getter;
}

export function isLessonCallSocketLive(socketId: string): boolean {
  if (!socketId || !resolveIo) return false;
  const io = resolveIo();
  if (!io) return false;
  const sock = io.sockets.sockets.get(socketId);
  return !!(sock && sock.connected);
}
