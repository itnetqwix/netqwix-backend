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
      // WRITE MONGO CONNECT
      await mongoose.connect(url);
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
