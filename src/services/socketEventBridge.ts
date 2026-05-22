import { log } from "../../logger";
import type { PubSubEnvelope } from "./eventPubSub";
import {
  emitToSession,
  emitToUser,
  emitToUsers,
  getBoundSocketIo,
} from "../modules/socket/socketEmit";

const logger = log.getLogger();

/** Deliver a pub/sub envelope to connected Socket.IO clients on this instance. */
export function deliverSocketEvent(envelope: PubSubEnvelope): boolean {
  const io = getBoundSocketIo();
  if (!io) {
    logger.debug(
      `[PubSub] skip ${envelope.event} — Socket.IO not bound yet`
    );
    return false;
  }

  const { target, event, payload } = envelope;

  if (target.kind === "domain") {
    return true;
  }

  switch (target.kind) {
    case "user":
      return emitToUser(target.userId, event, payload);
    case "users":
      emitToUsers(target.userIds, event, payload);
      return true;
    case "session":
      return emitToSession(target.sessionId, event, payload);
    case "room":
      io.to(target.room).emit(event, payload);
      return true;
    case "broadcast":
      io.emit(event, payload);
      return true;
    default:
      return false;
  }
}
