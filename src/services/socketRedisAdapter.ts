import { createAdapter } from "@socket.io/redis-adapter";
import type { Server } from "socket.io";
import { log } from "../../logger";
import { getRedisPubSub } from "./redisClient";
import { setSocketAdapterAttached } from "./socketAdapterState";

const logger = log.getLogger();

export async function attachSocketRedisAdapter(io: Server): Promise<boolean> {
  try {
    const pair = await getRedisPubSub();
    if (!pair) {
      setSocketAdapterAttached(false);
      return false;
    }
    io.adapter(createAdapter(pair.pub, pair.sub));
    setSocketAdapterAttached(true);
    return true;
  } catch (err: any) {
    setSocketAdapterAttached(false);
    logger.error(
      `[Socket] Redis adapter attach failed: ${err?.message || err}`
    );
    return false;
  }
}
