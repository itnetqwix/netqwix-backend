import { connectRedis, isRedisEnabled } from "../services/redisClient";
import { attachSocketRedisAdapter } from "../services/socketRedisAdapter";
import {
  startExtensionExpiryWorker,
  type ExtensionExpiryJob,
} from "../services/extensionTimerQueue";
import { log } from "../../logger";

const logger = log.getLogger();

let extensionWorkerStarted = false;

export async function bootstrapRedis(io: any): Promise<void> {
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
  if (!extensionWorkerStarted) {
    extensionWorkerStarted = true;
    startExtensionExpiryWorker(async (job: ExtensionExpiryJob) => {
      const { SessionExtensionService } = await import(
        "../modules/trainee/sessionExtensionService"
      );
      const svc = new SessionExtensionService();
      await svc.expireRequest(job.sessionId, job.requestId, job.reason);
    });
    logger.info("[Redis] Extension expiry worker started");
  }
}
