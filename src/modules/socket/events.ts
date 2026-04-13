import { Server } from "ws";
import { log } from "./../../../logger";
import { EVENTS } from "../../config/constance";
export class Events {
  private socket;
  private logger = log.getLogger();
  private io: Server;
  public initSocketEvents(socket, io: Server, nsp) {
    try {
      this.socket = socket;
      this.io = io;
      this.eventListener();
    } catch (err) {
      socket.emit(EVENTS.ON_ERROR, { msg: JSON.stringify(err) });
    }
  }

  // listening all the events
  public eventListener() {}
}
