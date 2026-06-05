/**
 * Abstraction for chat realtime emits (testable; default uses Socket.IO).
 */

import { EVENTS } from "../../config/constance";

export interface SocketEmitter {
  emitToChatRoom(conversationId: string, event: string, payload: unknown): void;
  isUserOnline(userId: string): boolean;
}

class DefaultSocketEmitter implements SocketEmitter {
  emitToChatRoom(conversationId: string, event: string, payload: unknown): void {
    const { publishSocketEventToChat } = require("../socket/socketEmit");
    void publishSocketEventToChat(conversationId, event, payload);
  }

  isUserOnline(userId: string): boolean {
    const { isUserOnline } = require("../socket/socket.service");
    return isUserOnline(userId);
  }
}

let emitter: SocketEmitter = new DefaultSocketEmitter();

export function getChatSocketEmitter(): SocketEmitter {
  return emitter;
}

export function setChatSocketEmitter(next: SocketEmitter): void {
  emitter = next;
}

export function emitChatMessage(conversationId: string, payload: unknown): void {
  getChatSocketEmitter().emitToChatRoom(conversationId, EVENTS.CHAT.MESSAGE, payload);
}

export function emitChatDelivered(conversationId: string, payload: unknown): void {
  getChatSocketEmitter().emitToChatRoom(conversationId, EVENTS.CHAT.DELIVERED, payload);
}
