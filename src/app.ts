import { DatabaseInit } from "./Utils/database";
import { Routes } from "./../routes";
import { log } from "./../logger";
import * as cors from "cors";
import * as l10n from "jm-ez-l10n";
import * as express from "express";
import * as http from "http";
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
import { bootstrapRedis } from "./bootstrap/redisBootstrap";
import { redisHealthCheck } from "./services/redisClient";
import {
  clusterInstanceCount,
  clusterInstanceLabel,
  isClusterLeader,
} from "./config/processRole";
import { isSocketAdapterAttached } from "./services/socketAdapterState";
import { requestContextMiddleware } from "./middleware/requestContext.middleware";

export class App {
  protected app: express.Application;
  private socketEvents = new SocketInit();
  private logger = log.getLogger();
  PORT = process.env.PORT;
  constructor() {
    this.app = express();
    this.app.set("trust proxy", 1);
    this.app.use(requestContextMiddleware);
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
        "Idempotency-Key",
        "X-Idempotency-Key",
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
    this.app.get("/health", async (_req, res) => {
      const redis = await redisHealthCheck();
      const { getPubSubMode, isPubSubActive } = await import("./services/eventPubSub");
      let messaging: unknown = { skipped: "lazy" };
      if (process.env.HEALTH_CHECK_MESSAGING === "true") {
        const { getMessagingHealth } = await import("./services/messagingHealth");
        messaging = await getMessagingHealth();
      }
      res.status(200).json({
        status: "ok",
        redis,
        socket: {
          adapterAttached: isSocketAdapterAttached(),
          clusterInstances: clusterInstanceCount(),
          instance: clusterInstanceLabel(),
          /** Polling needs sticky LB or a single PM2 worker; Redis adapter alone is not enough. */
          pollingRequiresStickyOrSingleWorker: clusterInstanceCount() > 1,
        },
        pubsub: { mode: getPubSubMode(), active: isPubSubActive() },
        messaging,
        uptimeSec: Math.floor(process.uptime()),
      });
    });
    this.app.use("/", route.routePath());
    l10n.setTranslationsFile("en", "src/language/translation.en.json");
    this.app.use(l10n.enableL10NExpress);

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

    void this.startHttpServer(corsOrigin);
  }

  /** Listen only after Redis + Socket.IO are ready (avoids early "Session ID unknown"). */
  private async startHttpServer(corsOrigin: ResolvedCorsOrigin): Promise<void> {
    const server = http.createServer(this.app);

    const peerServer = ExpressPeerServer(server, {
      path: "/",
      allow_discovery: false,
    });
    this.app.use("/peerjs", peerServer);
    this.logger.info("PeerJS signaling server mounted at /peerjs");

    const socketCorsOrigin = socketOriginsFromCors(corsOrigin);
    const io = socketio(server, {
      maxHttpBufferSize: 1e8,
      transports: ["websocket", "polling"],
      allowEIO3: true,
      cors: {
        origin: socketCorsOrigin,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    try {
      await bootstrapRedis(io);
    } catch (err: any) {
      this.logger.warn(`[Redis] bootstrap failed: ${err?.message || err}`);
    }

    if (clusterInstanceCount() > 1 && !isSocketAdapterAttached()) {
      this.logger.error(
        "[Socket] CRITICAL: multiple PM2 instances without Redis adapter — polling will fail"
      );
    }
    if (clusterInstanceCount() > 1) {
      this.logger.warn(
        "[Socket] PM2_INSTANCES>1: enable sticky sessions for polling or set PM2_INSTANCES=1"
      );
    }

    this.socketEvents.init(io, this.app);
    registerTrainerTraineePresenceProvider(() =>
      this.socketEvents.getTrainerTraineePresence()
    );

    server.listen(this.PORT, () => {
      this.logger.info(
        `[API] instance=${clusterInstanceLabel()} port=${process.env.PORT} socketReady=true`
      );
      new DatabaseInit();
    });

    if (isClusterLeader()) {
      cronjobs();
    } else {
      this.logger.info("[Cron] Skipped on non-leader cluster instance");
    }
  }
}
