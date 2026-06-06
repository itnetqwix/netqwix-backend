import { log } from "./../../logger";
import * as dotenv from "dotenv";
import * as mongoose from "mongoose";

dotenv.config();
export class DatabaseInit {
  // connection for database
  private log = log.getLogger();
  constructor() {
    // uncomment below line to connect DB
    this.connectDatabase();
  }

  private async connectDatabase() {
    try {
      const url = this.getConnectURL();
      await mongoose.connect(url, {
        // Keep connection pool small — we only have a handful of concurrent users.
        // Default is 100 which Atlas counts as 100 open connections even idle.
        maxPoolSize: 10,
        minPoolSize: 2,
        // Close idle connections after 30s to reduce Atlas connection cost.
        maxIdleTimeMS: 30_000,
        // Fail fast if Atlas is unreachable rather than hanging.
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 45_000,
        // Retry writes once on network errors (safe for idempotent ops).
        retryWrites: true,
        // Use majority write concern to avoid stale reads after writes.
        w: "majority",
      });
      console.log("🔥 Connected DB Name:", mongoose.connection.name);
      console.log("🔥 Connected Host:", mongoose.connection.host);
      this.log.info("Database connected successfully");
    } catch (err) {
      this.log.error(`mongo Connection error ---- `, err);
    }
  }

  private getConnectURL() {
    const url = process.env.MONGO_URL;
    return url;
  }
}
