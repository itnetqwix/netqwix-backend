import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import Redis from "ioredis";
import { log } from "../../logger";
import { PUBSUB_CHANNEL, PUBSUB_ENABLED } from "../config/pubsub";
import { REDIS_ENABLED, REDIS_URL } from "../config/redis";

const logger = log.getLogger();

export type SocketDeliveryTarget =
  | { kind: "user"; userId: string }
  | { kind: "users"; userIds: string[] }
  | { kind: "session"; sessionId: string }
  | { kind: "room"; room: string }
  | { kind: "broadcast" }
  | { kind: "domain" };

export type PubSubEnvelope = {
  v: 1;
  id: string;
  ts: number;
  source: string;
  target: SocketDeliveryTarget;
  event: string;
  payload: unknown;
};

export type PubSubHandler = (envelope: PubSubEnvelope) => void;

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

let busPub: Redis | null = null;
let busSub: Redis | null = null;
let subscriberReady = false;
const handlers: PubSubHandler[] = [];

function instanceLabel(): string {
  return (
    process.env.NODE_APP_INSTANCE ??
    process.env.pm_id ??
    process.env.HOSTNAME ??
    String(process.pid)
  );
}

function dispatch(envelope: PubSubEnvelope): void {
  for (const fn of handlers) {
    try {
      fn(envelope);
    } catch (err: any) {
      logger.error(`[PubSub] handler error: ${err?.message || err}`);
    }
  }
}

export function registerPubSubHandler(handler: PubSubHandler): void {
  handlers.push(handler);
}

export function isPubSubActive(): boolean {
  return PUBSUB_ENABLED && (REDIS_ENABLED ? subscriberReady : true);
}

export function getPubSubMode(): "disabled" | "local" | "redis" {
  if (!PUBSUB_ENABLED) return "disabled";
  return REDIS_ENABLED ? "redis" : "local";
}

async function ensureBusClients(): Promise<boolean> {
  if (!REDIS_ENABLED) return false;
  if (!busPub) {
    busPub = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    busSub = busPub.duplicate();
    busPub.on("error", (err) =>
      logger.error(`[PubSub] pub client: ${err?.message || err}`)
    );
    busSub.on("error", (err) =>
      logger.error(`[PubSub] sub client: ${err?.message || err}`)
    );
    const connects: Promise<void>[] = [];
    if (busPub.status === "wait") connects.push(busPub.connect());
    if (busSub.status === "wait") connects.push(busSub.connect());
    if (connects.length) await Promise.all(connects);
  }
  return true;
}

/**
 * Subscribe to the application event bus (Redis or in-process).
 * Call once during app bootstrap.
 */
export async function bootstrapEventPubSub(): Promise<void> {
  if (!PUBSUB_ENABLED) {
    logger.info("[PubSub] Disabled (PUBSUB_ENABLED=false)");
    return;
  }

  localBus.on("message", (envelope: PubSubEnvelope) => dispatch(envelope));

  if (!REDIS_ENABLED) {
    subscriberReady = true;
    logger.info("[PubSub] Local in-process bus ready");
    return;
  }

  const ok = await ensureBusClients();
  if (!ok || !busSub) {
    subscriberReady = true;
    logger.warn("[PubSub] Redis unavailable — using local bus only");
    return;
  }

  await busSub.subscribe(PUBSUB_CHANNEL);
  busSub.on("message", (channel, raw) => {
    if (channel !== PUBSUB_CHANNEL) return;
    try {
      const parsed = JSON.parse(String(raw)) as PubSubEnvelope;
      if (parsed?.v !== 1 || !parsed.event || !parsed.target) return;
      dispatch(parsed);
    } catch (err: any) {
      logger.warn(`[PubSub] invalid message: ${err?.message || err}`);
    }
  });

  subscriberReady = true;
  logger.info(`[PubSub] Redis subscriber on ${PUBSUB_CHANNEL}`);
}

function buildEnvelope(
  target: SocketDeliveryTarget,
  event: string,
  payload: unknown
): PubSubEnvelope {
  return {
    v: 1,
    id: randomUUID(),
    ts: Date.now(),
    source: instanceLabel(),
    target,
    event,
    payload,
  };
}

/**
 * Publish a real-time event to all API instances (each delivers via Socket.IO).
 * With Redis off, delivers immediately on this process only.
 */
export async function publishSocketEvent(
  target: SocketDeliveryTarget,
  event: string,
  payload: unknown
): Promise<PubSubEnvelope> {
  const envelope = buildEnvelope(target, event, payload);
  if (!PUBSUB_ENABLED) {
    return envelope;
  }

  if (REDIS_ENABLED) {
    try {
      const ok = await ensureBusClients();
      if (ok && busPub) {
        await busPub.publish(PUBSUB_CHANNEL, JSON.stringify(envelope));
        return envelope;
      }
    } catch (err: any) {
      logger.warn(
        `[PubSub] publish failed, local fallback: ${err?.message || err}`
      );
    }
  }

  localBus.emit("message", envelope);
  return envelope;
}

export function publishSocketEventToUser(
  userId: string,
  event: string,
  payload: unknown
): Promise<PubSubEnvelope> {
  return publishSocketEvent({ kind: "user", userId: String(userId) }, event, payload);
}

export function publishSocketEventToUsers(
  userIds: string[],
  event: string,
  payload: unknown
): Promise<PubSubEnvelope> {
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
): Promise<PubSubEnvelope> {
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
): Promise<PubSubEnvelope> {
  return publishSocketEvent({ kind: "room", room: String(room) }, event, payload);
}

export function publishSocketBroadcast(
  event: string,
  payload: unknown
): Promise<PubSubEnvelope> {
  return publishSocketEvent({ kind: "broadcast" }, event, payload);
}

/** Cache / side-effect only — no Socket.IO delivery. */
export async function publishDomainEvent(
  event: string,
  payload: unknown
): Promise<PubSubEnvelope> {
  const envelope = buildEnvelope({ kind: "domain" }, event, payload);
  if (!PUBSUB_ENABLED) {
    dispatch(envelope);
    return envelope;
  }
  if (REDIS_ENABLED) {
    try {
      const ok = await ensureBusClients();
      if (ok && busPub) {
        await busPub.publish(PUBSUB_CHANNEL, JSON.stringify(envelope));
        return envelope;
      }
    } catch (err: any) {
      logger.warn(`[PubSub] domain publish failed: ${err?.message || err}`);
    }
  }
  localBus.emit("message", envelope);
  return envelope;
}
