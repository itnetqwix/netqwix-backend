import Broadcast from "../../model/broadcast.schema";
import user from "../../model/user.schema";
import notification from "../../model/notifications.schema";
import push_token from "../../model/push_token.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { assertAdminUser } from "../admin/adminPermission";
import { CONSTANCE } from "../../config/constance";
import { SendEmail } from "../../Utils/sendEmail";
import SMSService from "../../services/sms-service";
import WhatsAppService from "../../services/whatsapp-service";
import { NotificationType } from "../../enum/notification.enum";
import * as webpush from "web-push";

const DELIVERY_LOG_CAP = 10_000;
const EMAIL_BATCH_SIZE = 50;

export class BroadcastService {
  private smsService: SMSService | null = null;
  private whatsAppService: WhatsAppService | null = null;

  private getSmsService(): SMSService | null {
    if (!this.smsService) {
      try {
        this.smsService = new SMSService();
      } catch {
        return null;
      }
    }
    return this.smsService;
  }

  private getWhatsAppService(): WhatsAppService | null {
    if (!this.whatsAppService) {
      this.whatsAppService = new WhatsAppService();
    }
    return this.whatsAppService.isConfigured() ? this.whatsAppService : null;
  }

  private buildUserQuery(audience: string, filter?: { status?: string[]; locations?: string[] }) {
    const q: any = {};
    if (audience !== "All") {
      q.account_type = audience;
    } else {
      q.account_type = { $in: ["Trainer", "Trainee"] };
    }
    if (filter?.status?.length) {
      q.status = { $in: filter.status };
    }
    return q;
  }

  public async getRecipientCount(authUser: any, query: any): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const { audience = "All", status } = query;
    const filter: any = {};
    if (status) filter.status = String(status).split(",").map((s: string) => s.trim());

    const userQuery = this.buildUserQuery(audience, filter);
    const count = await user.countDocuments(userQuery);

    const data: any = { count, audience };
    return ResponseBuilder.data(data, "Recipient count.");
  }

  public async createAndSend(body: any, authUser: any): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const { title, body: textBody, html_body, channels, audience, audience_filter } = body;

    if (!title || !title.trim()) return ResponseBuilder.badRequest("Title is required.");
    if (!channels || !channels.length) return ResponseBuilder.badRequest("At least one channel is required.");
    if (!audience) return ResponseBuilder.badRequest("Audience is required.");
    if (channels.includes("email") && !html_body?.trim()) {
      return ResponseBuilder.badRequest("HTML body is required when email channel is selected.");
    }
    const needsText = channels.some((c: string) => ["sms", "whatsapp", "push"].includes(c));
    if (needsText && !textBody?.trim()) {
      return ResponseBuilder.badRequest("Plain text body is required for SMS/WhatsApp/Push channels.");
    }

    const broadcastDoc = new Broadcast({
      title: title.trim(),
      body: textBody || "",
      html_body: html_body || "",
      channels,
      audience,
      audience_filter: audience_filter || { status: ["approved"] },
      status: "sending",
      sent_at: new Date(),
      created_by: authUser._id,
    });
    await broadcastDoc.save();

    this.executeBroadcast(broadcastDoc).catch((err) => {
      console.error("[Broadcast] Background execution error:", err);
    });

    const result = broadcastDoc.toObject();
    return ResponseBuilder.data(result, "Broadcast initiated.");
  }

  private async executeBroadcast(doc: any): Promise<void> {
    try {
      const userQuery = this.buildUserQuery(doc.audience, doc.audience_filter);
      const recipients = await user
        .find(userQuery)
        .select("_id fullname email mobile_no notifications subscriptionId account_type")
        .lean();

      doc.stats.total_recipients = recipients.length;
      await doc.save();

      if (!recipients.length) {
        doc.status = "completed";
        doc.completed_at = new Date();
        await doc.save();
        return;
      }

      const deliveryLog: any[] = [];
      const addLog = (userId: string, channel: string, status: string, error?: string) => {
        if (deliveryLog.length < DELIVERY_LOG_CAP) {
          deliveryLog.push({ user_id: userId, channel, status, error: error || null, sent_at: new Date() });
        }
      };

      const channels = doc.channels as string[];

      if (channels.includes("email")) {
        await this.sendEmailChannel(doc, recipients, addLog);
      }
      if (channels.includes("sms")) {
        await this.sendSmsChannel(doc, recipients, addLog);
      }
      if (channels.includes("whatsapp")) {
        await this.sendWhatsAppChannel(doc, recipients, addLog);
      }
      if (channels.includes("in_app")) {
        await this.sendInAppChannel(doc, recipients, addLog);
      }
      if (channels.includes("push")) {
        await this.sendPushChannel(doc, recipients, addLog);
      }

      doc.delivery_log = deliveryLog;
      doc.status = "completed";
      doc.completed_at = new Date();
      await doc.save();
    } catch (err) {
      console.error("[Broadcast] executeBroadcast error:", err);
      doc.status = "failed";
      await doc.save();
    }
  }

  private async sendEmailChannel(
    doc: any,
    recipients: any[],
    addLog: (uid: string, ch: string, st: string, err?: string) => void
  ) {
    const eligible = recipients.filter(
      (u) => u.email && u.notifications?.promotional?.email !== false
    );

    for (let i = 0; i < eligible.length; i += EMAIL_BATCH_SIZE) {
      const batch = eligible.slice(i, i + EMAIL_BATCH_SIZE);
      const emails = batch.map((u) => u.email);
      try {
        await SendEmail.sendRawEmailAsync(emails, doc.title, doc.html_body, doc.body || null);
        batch.forEach((u) => addLog(String(u._id), "email", "sent"));
        doc.stats.email.sent += batch.length;
      } catch (err: any) {
        batch.forEach((u) => addLog(String(u._id), "email", "failed", err?.message));
        doc.stats.email.failed += batch.length;
      }
    }
  }

  private async sendSmsChannel(
    doc: any,
    recipients: any[],
    addLog: (uid: string, ch: string, st: string, err?: string) => void
  ) {
    const sms = this.getSmsService();
    if (!sms) {
      console.warn("[Broadcast] SMS service not available.");
      return;
    }
    const eligible = recipients.filter(
      (u) => u.mobile_no && u.notifications?.promotional?.sms !== false
    );
    for (const u of eligible) {
      try {
        await sms.sendSMS(u.mobile_no, doc.body);
        addLog(String(u._id), "sms", "sent");
        doc.stats.sms.sent++;
      } catch (err: any) {
        addLog(String(u._id), "sms", "failed", err?.message);
        doc.stats.sms.failed++;
      }
    }
  }

  private async sendWhatsAppChannel(
    doc: any,
    recipients: any[],
    addLog: (uid: string, ch: string, st: string, err?: string) => void
  ) {
    const wa = this.getWhatsAppService();
    if (!wa) {
      console.warn("[Broadcast] WhatsApp service not configured.");
      return;
    }
    const eligible = recipients.filter((u) => u.mobile_no);
    for (const u of eligible) {
      try {
        await wa.sendWhatsApp(u.mobile_no, doc.body);
        addLog(String(u._id), "whatsapp", "sent");
        doc.stats.whatsapp.sent++;
      } catch (err: any) {
        addLog(String(u._id), "whatsapp", "failed", err?.message);
        doc.stats.whatsapp.failed++;
      }
    }
  }

  private async sendInAppChannel(
    doc: any,
    recipients: any[],
    addLog: (uid: string, ch: string, st: string, err?: string) => void
  ) {
    const docs = recipients.map((u) => ({
      title: doc.title,
      description: doc.body || doc.title,
      senderId: doc.created_by,
      receiverId: u._id,
      type: NotificationType.PROMOTIONAL,
    }));

    try {
      await notification.insertMany(docs, { ordered: false });
      recipients.forEach((u) => {
        addLog(String(u._id), "in_app", "sent");
      });
      doc.stats.in_app.sent += recipients.length;
    } catch (err: any) {
      console.error("[Broadcast] In-app insert error:", err?.message);
      recipients.forEach((u) => {
        addLog(String(u._id), "in_app", "failed", err?.message);
      });
      doc.stats.in_app.failed += recipients.length;
    }

    try {
      const { getIo } = require("../socket/socket.service");
      const io = getIo();
      if (io) {
        recipients.forEach((u) => {
          io.to(String(u._id)).emit("receive", {
            title: doc.title,
            description: doc.body || doc.title,
            type: NotificationType.PROMOTIONAL,
          });
        });
      }
    } catch {
      // Socket not available
    }
  }

  private async sendPushChannel(
    doc: any,
    recipients: any[],
    addLog: (uid: string, ch: string, st: string, err?: string) => void
  ) {
    const recipientIds = recipients.map((u) => u._id);

    // Expo push tokens
    const tokens = await push_token.find({ userId: { $in: recipientIds } }).lean();
    if (tokens.length) {
      const messages = tokens.map((t: any) => ({
        to: t.token,
        sound: "default" as const,
        title: doc.title,
        body: doc.body || doc.title,
        data: { kind: "broadcast", broadcastId: String(doc._id) },
        channelId: "lessons",
      }));

      const batchSize = 100;
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        try {
          const res = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          });
          if (res.ok) {
            doc.stats.push.sent += batch.length;
          } else {
            doc.stats.push.failed += batch.length;
          }
        } catch {
          doc.stats.push.failed += batch.length;
        }
      }
    }

    // Web push (VAPID)
    for (const u of recipients) {
      if (!u.subscriptionId) continue;
      try {
        const sub = JSON.parse(u.subscriptionId);
        await webpush.sendNotification(
          sub,
          JSON.stringify({ title: doc.title, description: doc.body || doc.title })
        );
        doc.stats.push.sent++;
        addLog(String(u._id), "push", "sent");
      } catch (err: any) {
        doc.stats.push.failed++;
        addLog(String(u._id), "push", "failed", err?.message);
      }
    }

    // Log for Expo tokens (aggregate per user)
    const tokenUserIds = new Set(tokens.map((t: any) => String(t.userId)));
    tokenUserIds.forEach((uid) => addLog(uid, "push", "sent"));
  }

  // ─── Admin List / Detail / Resend / Delete ────────────────────

  public async listBroadcasts(authUser: any, query: any): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const { search = "", page = 1, limit = 25 } = query;
    const filter: any = {};
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { body: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [broadcasts, total] = await Promise.all([
      Broadcast.find(filter)
        .select("-delivery_log -html_body")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("created_by", "fullname email")
        .lean(),
      Broadcast.countDocuments(filter),
    ]);

    const data: any = {
      broadcasts,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
    return ResponseBuilder.data(data, "Broadcasts fetched.");
  }

  public async getBroadcastById(authUser: any, id: string): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const doc = await Broadcast.findById(id)
      .populate("created_by", "fullname email")
      .populate("delivery_log.user_id", "fullname email")
      .lean();
    if (!doc) return ResponseBuilder.badRequest("Broadcast not found.", 404);

    return ResponseBuilder.data(doc, "Broadcast details.");
  }

  public async resendBroadcast(authUser: any, id: string): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const doc = await Broadcast.findById(id);
    if (!doc) return ResponseBuilder.badRequest("Broadcast not found.", 404);

    doc.status = "sending";
    doc.sent_at = new Date();
    doc.completed_at = null;
    doc.stats = {
      total_recipients: 0,
      email: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
      whatsapp: { sent: 0, failed: 0 },
      in_app: { sent: 0, failed: 0 },
      push: { sent: 0, failed: 0 },
    };
    doc.delivery_log = [];
    await doc.save();

    this.executeBroadcast(doc).catch((err) => {
      console.error("[Broadcast] Resend error:", err);
    });

    const result = doc.toObject();
    return ResponseBuilder.data(result, "Broadcast resend initiated.");
  }

  public async deleteBroadcast(authUser: any, id: string): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const deleted = await Broadcast.findByIdAndDelete(id);
    if (!deleted) return ResponseBuilder.badRequest("Broadcast not found.", 404);

    const result: any = { deleted: true };
    return ResponseBuilder.data(result, "Broadcast deleted.");
  }
}
