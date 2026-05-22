import { REDIS_ENABLED, REDIS_URL } from "../config/redis";

/** Shared BullMQ connection options (same Redis as Socket.IO / caches). */
export function getBullmqConnection() {
  return {
    url: REDIS_URL,
    maxRetriesPerRequest: null as null,
  };
}

export function isBullmqAvailable(): boolean {
  return REDIS_ENABLED;
}
