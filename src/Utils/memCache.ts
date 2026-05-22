import { log } from "../../logger";
import { REDIS_KEYS, REDIS_TTL } from "../config/redis";
import {
  getRedis,
  isRedisEnabled,
} from "../services/redisClient";

/**
 * Socket registry: userId → socketId.
 * When REDIS_ENABLED, uses Redis; otherwise in-process object (legacy).
 */
export class MemCache {
  public static async setDetail(set: string, key: string, val: any): Promise<void> {
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      const redis = getRedis();
      if (redis) {
        await redis.set(
          REDIS_KEYS.socketRegistry(key),
          String(val),
          "EX",
          REDIS_TTL.SOCKET_REGISTRY_SEC
        );
      }
    }
    if (!this.memCache[set]) {
      this.memCache[set] = {};
    }
    this.memCache[set][key] = val;
  }

  /** Sync setter for hot paths — writes memory immediately, Redis async. */
  public static setDetailSync(set: string, key: string, val: any): void {
    if (!this.memCache[set]) {
      this.memCache[set] = {};
    }
    this.memCache[set][key] = val;
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      void this.setDetail(set, key, val);
    }
  }

  public static getDetail(set: string, key: string): any {
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      const mem = this.memCache[set]?.[key];
      if (mem != null) return mem;
    } else if (this.memCache[set] && this.memCache[set][key]) {
      return this.memCache[set][key];
    }
    return null;
  }

  /** Prefer this from socket handlers when Redis may be on another pod. */
  public static async getDetailAsync(set: string, key: string): Promise<any> {
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      const redis = getRedis();
      if (redis) {
        const fromRedis = await redis.get(REDIS_KEYS.socketRegistry(key));
        if (fromRedis) {
          if (!this.memCache[set]) this.memCache[set] = {};
          this.memCache[set][key] = fromRedis;
          return fromRedis;
        }
      }
    }
    return this.getDetail(set, key);
  }

  public static async deleteDetail(set: string, key: string): Promise<void> {
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      const redis = getRedis();
      if (redis) {
        await redis.del(REDIS_KEYS.socketRegistry(key));
      }
    }
    if (this.memCache[set] && this.memCache[set][key]) {
      delete this.memCache[set][key];
    }
  }

  public static deleteDetailSync(set: string, key: string): void {
    if (this.memCache[set] && this.memCache[set][key]) {
      delete this.memCache[set][key];
    }
    if (isRedisEnabled() && set === process.env.SOCKET_CONFIG) {
      void this.deleteDetail(set, key);
    }
  }

  public static getAll() {
    return this.memCache;
  }

  private static logger = log.getLogger();
  private static memCache: Record<string, Record<string, any>> = {};
}
