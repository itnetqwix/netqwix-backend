import type { Server } from "socket.io";
import { log } from "../../../logger";
import { handleSocketEvents, setIoInstance } from "./socket.service";
import { EVENTS } from "../../config/constance";
import { AuthMiddleware } from "../auth/authMiddleware";
import { MemCache } from "../../Utils/memCache";
import { AdminService } from "../admin/adminService";

export class SocketInit {
  private static readonly ADMIN_ROOM = "admin-presence";

  private logger = log.getLogger();
  private middleware: AuthMiddleware = new AuthMiddleware();
  private adminService = new AdminService();
  private metricsPushTimer: ReturnType<typeof setInterval> | null = null;

  private connectedUsers = new Map<string, { socketId: string; userData: any }>(); // Updated to store userId and complete user data

  private flattenUserDoc(userData: any): any {
    if (!userData) return null;
    return userData._doc ? userData._doc : userData;
  }

  /** Trainers & trainees currently connected (one row per user id). */
  private serializeTrainerTraineePresence(): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    for (const { userData } of this.connectedUsers.values()) {
      const doc = this.flattenUserDoc(userData);
      if (!doc?._id) continue;
      const at = String(doc.account_type || "").toLowerCase();
      if (at !== "trainer" && at !== "trainee") continue;
      const id = String(doc._id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        _id: doc._id,
        id: String(doc._id),
        fullname: doc.fullname,
        email: doc.email,
        mobile_no: doc.mobile_no,
        profile_picture: doc.profile_picture,
        account_type: doc.account_type,
        category: doc.category,
        wallet_amount: doc.wallet_amount,
        commission: doc.commission,
        login_type: doc.login_type,
      });
    }
    return out;
  }

  private emitTrainerTraineePresence(io: Server) {
    const users = this.serializeTrainerTraineePresence();
    io.to(SocketInit.ADMIN_ROOM).emit("ADMIN_ONLINE_USERS", {
      users,
      updatedAt: Date.now(),
    });
  }

  /** Same payload as ADMIN_ONLINE_USERS (trainers/trainees with an active socket on this server). */
  public getTrainerTraineePresence = (): any[] => this.serializeTrainerTraineePresence();

  private async pushDashboardMetrics(io: Server) {
    try {
      const metrics = await this.adminService.getDashboardMetricsInternal();
      if (metrics) {
        io.to(SocketInit.ADMIN_ROOM).emit("ADMIN_DASHBOARD_METRICS", {
          metrics,
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      this.logger.info(`[AdminRealtime] metrics push failed: ${e}`);
    }
  }

  public init = (io: Server, app) => {
    // Set the io instance for use in socket service helpers
    setIoInstance(io);

    if (this.metricsPushTimer) {
      clearInterval(this.metricsPushTimer);
    }
    this.metricsPushTimer = setInterval(() => {
      void this.pushDashboardMetrics(io);
    }, 30000);
    
    io.use(async (socket, next) => {
      const token =
        socket.handshake?.auth?.authorization ||
        socket.handshake?.query?.authorization;

      if (!token) {
        this.logger.info(`Socket auth failed: missing token`);
        return next(new Error("Socket authentication token missing"));
      }

      try {
        const userInfo = await this.middleware.loadSocketUser(token);
        if (userInfo?.user) {
          this.logger.info(`User Connected --> ${userInfo.user._id}`);
          socket.user = userInfo.user;
          return next();
        }

        this.logger.info(`After Connection getting ERR -> ${JSON.stringify(userInfo)}`);
        this.logger.info(`token --- , ${JSON.stringify(token)}`);
        return next(new Error("Socket authentication failed"));
      } catch (error) {
        this.logger.info(`Socket auth exception -> ${JSON.stringify(error)}`);
        return next(new Error("Socket authentication error"));
      }
    })
    .on("connection", async (socket) => {
      try {
        socket.emit(EVENTS.ON_CONNECT, {
          msg: "Welcome, Socket Connect Successfully, socket",
        });
        
        // Store the complete user data
        const userId = String(socket.user._id);
        this.connectedUsers.set(userId, { socketId: socket.id, userData: socket.user });
        MemCache.setDetail(process.env.SOCKET_CONFIG, userId, socket.id);
        this.logger.info(`[MemCache] ✅ Socket registered: userId=${userId} socketId=${socket.id}`);

        const accountType = String(this.flattenUserDoc(socket.user)?.account_type || "").toLowerCase();
        if (accountType === "admin") {
          await socket.join(SocketInit.ADMIN_ROOM);
          void this.pushDashboardMetrics(io);
        }

        this.emitTrainerTraineePresence(io);
        
        // Handle socket events
        handleSocketEvents(socket);
        
        // Handle disconnect event
        onDisconnect(socket, io);
        
        // Optional: Log all connected users
        this.logger.info(`Currently connected users: ${Array.from(this.connectedUsers.keys())}`);
      } catch (err) {
        this.logger.info(`After Connection getting ERR -> ${err}`);
        socket.emit(EVENTS.ON_ERROR, { msg: JSON.stringify(err) });
      }
    });

    const onDisconnect = (socket, io: Server) => {
      // Socket.IO emits the built-in "disconnect" event; relying on a custom
      // ON_DISCONNECT event leaves stale socket ids in MemCache and breaks
      // peer signaling (calls target dead sockets).
      socket.on("disconnect", async () => {
        const userId = String(socket.user._id);
        this.logger.info(`User Disconnected ---> ${userId}`);
        
        // Remove the user from the connected users map
        this.connectedUsers.delete(userId);
        MemCache.deleteDetail(process.env.SOCKET_CONFIG, userId);

        this.emitTrainerTraineePresence(io);

        // Optional: Log remaining connected users
        this.logger.info(`Currently connected users: ${Array.from(this.connectedUsers.keys())}`);
      });
    }
  };

  // Method to retrieve the list of connected users with complete data
  public getConnectedUsers = () => {
    return Array.from(this.connectedUsers.values()); // Return an array of user data objects
  };
}

/** Module augmentation — auth middleware sets `socket.user` on Socket.IO sockets */
declare module "socket.io" {
  interface Socket {
    user?: any;
  }
}
