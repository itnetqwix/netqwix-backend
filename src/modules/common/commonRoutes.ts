import { Router } from "express";
import { commonController } from "./commonController";
import { ChatController } from "../chat/chatController";
import multer = require("multer");
import fs = require("fs");
import { AuthorizeMiddleware } from "../../middleware/authorize.middleware";

const uploadDirectory = "./uploads";
const authorizeMiddleware = new AuthorizeMiddleware();

if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory);
}

const destination = (req, file, cb) => {
  cb(null, uploadDirectory);
};

const filename = (req, file, cb) => {
  cb(null, Date.now() + "-" + file.originalname);
};

const storage = multer.diskStorage({
  destination,
  filename,
});

const upload = multer({ storage });
// const thumbnailUpload = multer({ dest: 'uploads/' });

const route: Router = Router();
route.use([
  (req, res, next) => {
    req.byPassRoute = ['/sign-up'];
    next();
  },
  authorizeMiddleware.authorizeUser,
]);
const commonC = new commonController();
route.post("/extend-session-end-time", commonC.addExtendedSessionEndTime);
route.post("/upload", upload.single("files"), commonC.uploads);
route.post("/video-upload-url", commonC.videoUploadUrl);
route.post("/saved-sessions-upload-url", commonC.sessionsVideoUploadUrl);
route.post("/get-all-saved-sessions", commonC.getAllSavedSession);
route.post("/pdf-upload-url", commonC.pdfUploadUrl);
route.post("/get-clips", commonC.getClips);
route.post("/trainee-clips", commonC.traineeClips);
route.delete('/delete-clip/:id', commonC.deleteClip);
route.delete('/delete-saved-session/:id', commonC.deleteSavedSession);
route.put("/update-profile-picture", commonC.profileImageUrl);
route.post("/generate-thumbnail", upload.single('video'), commonC.generateThumbnail);
route.post("/featured-content-upload-url", commonC.featuredContentUploadUrl);

route.post("/chat-media-upload-url", commonC.chatMediaUploadUrl);

const chatC = new ChatController();
route.get("/chat-conversations", chatC.getConversations);
route.get("/chat-messages/:conversationId", chatC.getMessages);
route.post("/chat-send", chatC.sendMessage);
route.post("/chat-conversation", chatC.getOrCreateConversation);
route.post("/chat-create-group", chatC.createGroup);

export const commonRoute: Router = route;