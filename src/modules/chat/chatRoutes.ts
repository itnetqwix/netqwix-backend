import { Router } from "express";
import { ChatController } from "./chatController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { chatSendLimiter } from "../../middleware/rateLimit.middleware";

const route = Router();
const chatC = new ChatController();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use(authorizeMiddleware.authorizeUser);

route.get("/conversations", chatC.getConversations);
route.get("/messages/:conversationId", chatC.getMessages);
route.post("/send", chatSendLimiter, chatC.sendMessage);
route.post("/conversation", chatC.getOrCreateConversation);

export default route;
