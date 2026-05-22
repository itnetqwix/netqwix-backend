import { createAdapter } from "@socket.io/redis-adapter";
import type { Server } from "socket.io";
import { getRedisPubSub } from "./redisClient";

export async function attachSocketRedisAdapter(io: Server): Promise<boolean> {
  const pair = await getRedisPubSub();
  if (!pair) return false;
  io.adapter(createAdapter(pair.pub, pair.sub));
  return true;
}
