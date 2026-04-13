import { log } from "../../logger";

export class MemCache {
  public static setDetail(set: string, key: string, val: any) {
    if (!this.memCache[set]) {
      this.memCache[set] = {};
    }
    this.memCache[set][key] = val;
    // this.logger.debug(`*inMemory* hset: ${set} :: ${key} :: ${val}`);
  }

  public static getDetail(set: string, key: string) {
    let val = null;
    if (this.memCache[set] && this.memCache[set][key]) {
      val = this.memCache[set][key];
    }
    // this.logger.debug(`*inMemory* hget: ${set} :: ${key} :: ${val}`);
    return val;
  }

  public static deleteDetail(set: string, key: string) {
    if (this.memCache[set] && this.memCache[set][key]) {
      delete this.memCache[set][key];
    }
    // this.logger.debug(`*inMemory* hdel: ${set} :: ${key}`);
  }

  public static getAll() {
    return this.memCache;
  }
  private static logger = log.getLogger();

  private static memCache = {};
}
