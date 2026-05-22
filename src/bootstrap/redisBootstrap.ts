import { connectRedis, isRedisEnabled } from "../services/redisClient";
import { attachSocketRedisAdapter } from "../services/socketRedisAdapter";
import { isSocketAdapterAttached } from "../services/socketAdapterState";
import { bootstrapEventPubSubBridge } from "./eventPubSubBootstrap";
import { bootstrapJobWorkers } from "./jobWorkersBootstrap";
import { clusterInstanceCount } from "../config/processRole";
import { log } from "../../logger";

const logger = log.getLogger();

export async function bootstrapRedis(io: any): Promise<void> {
  await bootstrapEventPubSubBridge();

  if (!isRedisEnabled()) {
    logger.info("[Redis] Disabled (REDIS_ENABLED=false)");
    if (clusterInstanceCount() > 1) {
      logger.error(
        "[Socket] CRITICAL: PM2 cluster with REDIS_ENABLED=false — Socket.IO will return 'Session ID unknown'"
      );
    }
    return;
  }
  const ok = await connectRedis();
  if (!ok) {
    logger.warn("[Redis] Enabled but connection failed — falling back to in-memory caches");
    if (clusterInstanceCount() > 1) {
      logger.error(
        "[Socket] CRITICAL: Redis down with PM2 cluster — polling will fail (Session ID unknown)"
      );
    }
    return;
  }
  const adapted = await attachSocketRedisAdapter(io);
  if (adapted) {
    logger.info("[Redis] Socket.IO adapter attached");
  } else if (clusterInstanceCount() > 1) {
    logger.error(
      "[Socket] CRITICAL: Redis adapter NOT attached with multiple PM2 instances — deploy fix or set PM2_INSTANCES=1"
    );
  }
  bootstrapJobWorkers();
}

export function socketRedisReady(): boolean {
  return !isRedisEnabled() || isSocketAdapterAttached();
}
