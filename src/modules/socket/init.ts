import type { Server } from "socket.io";
import { log } from "../../../logger";
import { Events } from "./events";
import { handleSocketEvents, setIoInstance } from "./socket.service";
import { EVENTS } from "../../config/constance";
import { AuthMiddleware } from "../auth/authMiddleware";
import { MemCache } from "../../Utils/memCache";

export class SocketInit {
  private logger = log.getLogger();
  private middleware: AuthMiddleware = new AuthMiddleware();
  
  private connectedUsers = new Map<string, { socketId: string; userData: any }>(); // Updated to store userId and complete user data


  public init = (io: Server, app) => {
    // Set the io instance for use in socket service helpers
    setIoInstance(io);
    
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
        
        // Handle socket events
        handleSocketEvents(socket);
        
        // Handle disconnect event
        onDisconnect(socket);
        
        // Optional: Log all connected users
        this.logger.info(`Currently connected users: ${Array.from(this.connectedUsers.keys())}`);
      } catch (err) {
        this.logger.info(`After Connection getting ERR -> ${err}`);
        socket.emit(EVENTS.ON_ERROR, { msg: JSON.stringify(err) });
      }
    });

    const onDisconnect = (socket) => {
      // Socket.IO emits the built-in "disconnect" event; relying on a custom
      // ON_DISCONNECT event leaves stale socket ids in MemCache and breaks
      // peer signaling (calls target dead sockets).
      socket.on("disconnect", async () => {
        const userId = String(socket.user._id);
        this.logger.info(`User Disconnected ---> ${userId}`);
        
        // Remove the user from the connected users map
        this.connectedUsers.delete(userId);
        MemCache.deleteDetail(process.env.SOCKET_CONFIG, userId);

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
