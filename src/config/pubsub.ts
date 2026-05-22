import { REDIS_PREFIX } from "./redis";

/** Application event bus (Redis Pub/Sub). Disable only for debugging. */
export const PUBSUB_ENABLED =
  String(process.env.PUBSUB_ENABLED ?? "true").toLowerCase() === "true";

/** Main channel for cross-instance socket + domain events. */
export const PUBSUB_CHANNEL =
  process.env.PUBSUB_CHANNEL || `${REDIS_PREFIX}:pubsub:events`;

/** Optional prefix for typed domain handlers (cache, analytics, etc.). */
export const PUBSUB_DOMAIN_PREFIX = `${REDIS_PREFIX}:domain:`;
