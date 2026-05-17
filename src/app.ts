import { DatabaseInit } from "./Utils/database";
import { Routes } from "./../routes";
import { log } from "./../logger";
import * as cors from "cors";
import * as l10n from "jm-ez-l10n";
import * as express from "express";
const socketio = require("socket.io");
const { ExpressPeerServer } = require("peer");

import * as bodyParser from "body-parser";
import "./config/loadEnv";
import { resolveCorsOrigins, type ResolvedCorsOrigin } from "./config/corsOrigins";

function formatCorsOriginsForLog(origin: ResolvedCorsOrigin): string {
  if (origin === "*") return "*";
  if (origin === true) return "(reflect request origin)";
  if (origin === false) return "(disabled)";
  return JSON.stringify(origin);
}

function socketOriginsFromCors(origin: ResolvedCorsOrigin): string | string[] {
  if (origin === "*" || origin === true || origin === false) {
    return "*";
  }
  if (typeof origin === "string") {
    return origin;
  }
  if (Array.isArray(origin)) {
    return origin.filter((o): o is string => typeof o === "string");
  }
  return "*";
}
import { SocketInit } from "./modules/socket/init";
import { registerTrainerTraineePresenceProvider } from "./modules/socket/socketPresenceRegistry";
import { cronjobs } from "./cronjob";
import { webhookRoute } from "./modules/wallet/webhookRoutes";
import { securityHeaders } from "./middleware/securityHeaders.middleware";
import { globalApiLimiter } from "./middleware/rateLimit.middleware";
import { AuthorizeMiddleware } from "./middleware/authorize.middleware";

export class App {
  protected app: express.Application;
  private socketEvents = new SocketInit();
  private logger = log.getLogger();
  PORT = process.env.PORT;
  constructor() {
    this.app = express();
    this.app.use(securityHeaders);
    this.app.use(globalApiLimiter);
    this.app.use("/public/assets", express.static("uploads"));
    this.app.use("/webhooks", webhookRoute);
    const route = new Routes();
    this.app.use(bodyParser.json());
    const corsOrigin = resolveCorsOrigins();
    const corsOptions: cors.CorsOptions = {
      origin: corsOrigin,
      credentials: true,
      methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Origin",
        "Accept",
        "Access-Control-Allow-Origin",
        "X-Session-Id",
      ],
    };
    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));
    if (process.env.NODE_ENV !== "test") {
      this.logger.info(
        `[CORS] allowed origins: ${formatCorsOriginsForLog(corsOrigin)}`
      );
    }
    this.app.use(bodyParser.json({ limit: '50mb' }));
    this.app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    this.app.use("/", route.routePath());
    l10n.setTranslationsFile("en", "src/language/translation.en.json");
    this.app.use(l10n.enableL10NExpress);
    const server = this.app.listen(this.PORT, () => {
      this.logger.info(
        `The server is running in port localhost: ${process.env.PORT}`
      );
      // connecting to the Database
      new DatabaseInit();
    });
    // it's a function to execute all cron jobs
    cronjobs();

    // Mount self-hosted PeerJS signaling server at /peerjs.
    // This eliminates dependency on the unreliable PeerJS public cloud (0.peerjs.com)
    // so both trainer and trainee always use the same signaling server as the backend.
    const peerServer = ExpressPeerServer(server, {
      path: "/",
      allow_discovery: false,
    });
    this.app.use("/peerjs", peerServer);
    this.logger.info("PeerJS signaling server mounted at /peerjs");

    const socketCorsOrigin = socketOriginsFromCors(corsOrigin);
    const io = socketio(server, {
      maxHttpBufferSize: 1e8,
      transports: ['websocket', 'polling'], // Explicitly allow both transports
      allowEIO3: true, // Allow Engine.IO v3 clients
      cors: {
        origin: socketCorsOrigin,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000, // Increase ping timeout
      pingInterval: 25000, // Increase ping interval
    });
    this.socketEvents.init(io, this.app);
    registerTrainerTraineePresenceProvider(() => this.socketEvents.getTrainerTraineePresence());

  const authorizeMiddleware = new AuthorizeMiddleware();
  this.app.get("/connected-users", (req, res, next) => {
    authorizeMiddleware.authorizeUser(req, res, () => {
      const { assertAdminUser } = require("./modules/admin/adminPermission");
      const denied = assertAdminUser(req["authUser"]);
      if (denied) {
        return res.status(403).json({ status: 0, error: denied });
      }
      const connectedUsers = this.socketEvents.getConnectedUsers();
      return res.json({ connectedUsers });
    });
  });
  }
}
