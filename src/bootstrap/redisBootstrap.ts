import { connectRedis, isRedisEnabled } from "../services/redisClient";
import { attachSocketRedisAdapter } from "../services/socketRedisAdapter";
import { bootstrapEventPubSubBridge } from "./eventPubSubBootstrap";
import { bootstrapJobWorkers } from "./jobWorkersBootstrap";
import { log } from "../../logger";

const logger = log.getLogger();

export async function bootstrapRedis(io: any): Promise<void> {
  await bootstrapEventPubSubBridge();

  if (!isRedisEnabled()) {
    logger.info("[Redis] Disabled (REDIS_ENABLED=false)");
    return;
  }
  const ok = await connectRedis();
  if (!ok) {
    logger.warn("[Redis] Enabled but connection failed — falling back to in-memory caches");
    return;
  }
  const adapted = await attachSocketRedisAdapter(io);
  if (adapted) {
    logger.info("[Redis] Socket.IO adapter attached");
  }
  bootstrapJobWorkers();
}
