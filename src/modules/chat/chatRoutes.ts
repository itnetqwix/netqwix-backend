/**
 * Canonical chat REST surface at /chat.
 * Legacy /common/chat-* routes remain as aliases (see commonRoutes).
 */

import { Router } from "express";
import { ChatController } from "./chatController";
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";
import { chatSendLimiter } from "../../middleware/rateLimit.middleware";
import { assertAdminUser } from "../admin/adminPermission";

const route = Router();
const chatC = new ChatController();
const authorizeMiddleware = new AuthorizeMiddleware();

route.use(authorizeMiddleware.authorizeUser);

route.get("/conversations", chatC.getConversations);
route.get("/messages/:conversationId", chatC.getMessages);
route.post("/send", chatSendLimiter, chatC.sendMessage);
route.post("/conversation", chatC.getOrCreateConversation);

route.post("/create-group", chatC.createGroup);
route.post("/create-group-invite", chatC.createGroupWithInvites);
route.post("/edit-message", chatC.editMessage);
route.post("/delete-message", chatC.deleteMessage);
route.post("/archive", chatC.archiveConversation);
route.post("/unarchive", chatC.unarchiveConversation);
route.post("/delete-conversation", chatC.deleteConversation);
route.post("/clear", chatC.clearConversation);
route.get("/group-invites", chatC.getGroupInvites);
route.post("/group-invite-respond", chatC.respondGroupInvite);
route.get("/group/:conversationId", chatC.getGroupDetail);
route.get("/group/:conversationId/members", chatC.getGroupMembers);
route.post("/group/:conversationId/invite", chatC.inviteToGroup);
route.post("/group/:conversationId/remove-member", chatC.removeGroupMember);
route.post("/group/:conversationId/exit", chatC.exitGroup);
route.post("/group/:conversationId/delete", chatC.deleteGroup);
route.post("/group/:conversationId/update", chatC.updateGroup);
route.get("/policy", chatC.getChatPolicy);

route.get("/flagged", (req, res) => {
  const denied = assertAdminUser((req as any).authUser);
  if (denied) return res.status(403).json({ status: 0, error: denied });
  return chatC.getFlaggedChats(req, res);
});
route.post("/flag-update", (req, res) => {
  const denied = assertAdminUser((req as any).authUser);
  if (denied) return res.status(403).json({ status: 0, error: denied });
  return chatC.updateFlagStatus(req, res);
});

export default route;
