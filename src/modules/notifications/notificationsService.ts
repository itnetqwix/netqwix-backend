import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import * as webpush from 'web-push';
import notification from "../../model/notifications.schema";
import mongoose from "mongoose";
import user from "../../model/user.schema";
import push_token from "../../model/push_token.schema";



//NOTE -  Set VAPID details
webpush.setVapidDetails(
    'mailto:example@yourdomain.org',
    process.env.WEB_PUSH_PUBLIC_KEY,
    process.env.WEB_PUSH_PRIVATE_KEY

  );
export class NotificationsService {

  public async getPublicKey(): Promise<ResponseBuilder> {
    try{
      return ResponseBuilder.data({publicKey : process.env.WEB_PUSH_PUBLIC_KEY}, l10n.t("Web Push Public key"));
    }
    catch(error){
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getSubscription(req: any): Promise<ResponseBuilder> {
    try{
         const userId = req?.authUser?._id ;
         const {subscription} = req?.body ;
         await user.findByIdAndUpdate(userId , {$set : {subscriptionId : JSON.stringify(subscription)}}) ;
         return ResponseBuilder.successMessage("Subscription Id Updated successfully");
    }
    catch(error){
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
    public async getNotifications(req : any): Promise<ResponseBuilder> {
      try{
          const userId = req?.authUser?._id;
          const {page , limit} = req?.query ;
        const notifications = await notification.find(
            {
                receiverId : userId
            }
        )
        .populate('senderId')
        .sort({createdAt : -1})
        .skip(parseInt(limit) * (parseInt(page) - 1))
        .limit(parseInt(limit));
        const data =  notifications?.map((notification) =>{
            return {
                _id : notification?._id ,
                title : notification?.title,
                description : notification?.description,
                createdAt : notification?.createdAt,
                isRead : notification?.isRead,
                sender : {
                    _id : notification?.senderId?._id,
                    name : notification?.senderId?.fullname,
                    profile_picture : notification?.senderId?.profile_picture || null
                }
            }
        })
        return ResponseBuilder.data(data, l10n.t("Get All Notifications"));
    }
    catch(error){
        console.error("Error getting notifications:", error);
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
    public async updateNotificationsStatus(req : any): Promise<ResponseBuilder> {
      try{
          const userId = req?.authUser?._id;
          const {page} = req?.body ;

          const notifications = await notification.find({
            receiverId: userId,
            isRead: false
          })
          .sort({ createdAt: -1 }) 
          .limit(10)
          .skip((page - 1) * 10)
          
          const notificationIds = notifications?.map(notif => notif._id) || [];
          
          await notification.updateMany(
            { _id: { $in: notificationIds } },
            { $set: { isRead: true } }
          );
          return ResponseBuilder.successMessage("Notification Status Updated successfully");
    }
    catch(error){
        console.error("Error updating notification status:", error);
        return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async registerPushToken(userId: string, token: string, platform: string, deviceId: string, kind: string): Promise<ResponseBuilder> {
    try {
      if (!token || !deviceId) {
        return ResponseBuilder.badRequest("token and deviceId are required");
      }
      await push_token.findOneAndUpdate(
        { deviceId },
        { userId, token, platform: platform || "android", kind: kind || "expo", updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return ResponseBuilder.successMessage("Push token registered");
    } catch (error) {
      console.error("Error registering push token:", error);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async unregisterPushToken(deviceId: string): Promise<ResponseBuilder> {
    try {
      if (!deviceId) return ResponseBuilder.badRequest("deviceId is required");
      await push_token.deleteMany({ deviceId });
      return ResponseBuilder.successMessage("Push token unregistered");
    } catch (error) {
      console.error("Error unregistering push token:", error);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    try {
      const category = String((data as any)?.category ?? "")
        .toLowerCase()
        .trim();
      const threadIdFromData =
        (data as any)?.threadId ??
        (data as any)?.conversationId ??
        (data as any)?.lessonId ??
        null;
      const urgentKind =
        String((data as any)?.kind ?? "") === "instant_lesson_request" ||
        category === "session_starting" ||
        category === "instant_lesson";

      const gate = await shouldSuppressNotification(userId, category, urgentKind);
      if (gate.suppress) {
        if (process.env.PUSH_DEBUG === "1") {
          console.log(
            `[PushNotification] suppressed for ${userId} (${gate.reason}, cat=${category || "n/a"})`
          );
        }
        return;
      }

      const tokens = await push_token.find({ userId }).lean();
      if (!tokens.length) return;

      const channelId = resolveAndroidChannel(category);
      const threadId = threadIdFromData ? String(threadIdFromData) : undefined;
      const collapseId = threadId ?? (category ? `nq:${category}` : undefined);

      const messages = tokens.map((t: any) => ({
        to: t.token,
        sound: "default" as const,
        title,
        body,
        data: data || {},
        channelId,
        /** iOS — collapses related pushes into one stack. */
        ...(threadId ? { _displayInForeground: true, threadId } : {}),
        /** Android — same logical group, identical sub-channel. */
        ...(collapseId ? { collapseId } : {}),
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
          if (!res.ok) {
            console.error("[PushNotification] Expo API error:", res.status, await res.text());
          }
        } catch (fetchErr) {
          console.error("[PushNotification] Fetch error:", fetchErr);
        }
      }
    } catch (err) {
      console.error("[PushNotification] Error:", err);
    }
  }

  // ─── Preference endpoints ─────────────────────────────────────
  public async getPreferences(userId: string): Promise<ResponseBuilder> {
    try {
      const u: any = await user.findById(userId).select("notifications privacy").lean();
      if (!u) return ResponseBuilder.badRequest("User not found");
      return ResponseBuilder.data(u.notifications ?? {}, "notification preferences");
    } catch (err) {
      console.error("[NotificationPrefs.get]", err);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async updatePreferences(
    userId: string,
    patch: Partial<{
      channels: any;
      bookingReminderCadence: string;
      promotional: { email?: boolean; sms?: boolean };
      transactional: { email?: boolean; sms?: boolean };
    }>
  ): Promise<ResponseBuilder> {
    try {
      const set: Record<string, unknown> = {};
      if (patch.channels) {
        for (const cat of NOTIFICATION_CATEGORIES) {
          const c = patch.channels[cat];
          if (!c) continue;
          if (typeof c.push === "boolean")
            set[`notifications.channels.${cat}.push`] = c.push;
          if (typeof c.email === "boolean")
            set[`notifications.channels.${cat}.email`] = c.email;
          if (typeof c.sms === "boolean")
            set[`notifications.channels.${cat}.sms`] = c.sms;
        }
      }
      if (patch.bookingReminderCadence) {
        set["notifications.bookingReminderCadence"] = patch.bookingReminderCadence;
      }
      if (patch.promotional) {
        if (typeof patch.promotional.email === "boolean")
          set["notifications.promotional.email"] = patch.promotional.email;
        if (typeof patch.promotional.sms === "boolean")
          set["notifications.promotional.sms"] = patch.promotional.sms;
      }
      if (patch.transactional) {
        if (typeof patch.transactional.email === "boolean")
          set["notifications.transactional.email"] = patch.transactional.email;
        if (typeof patch.transactional.sms === "boolean")
          set["notifications.transactional.sms"] = patch.transactional.sms;
      }
      await user.findByIdAndUpdate(userId, { $set: set });
      return this.getPreferences(userId);
    } catch (err) {
      console.error("[NotificationPrefs.update]", err);
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async setMuteUntil(
    userId: string,
    until: Date | null
  ): Promise<ResponseBuilder> {
    try {
      await user.findByIdAndUpdate(userId, {
        $set: { "notifications.mute_until": until },
      });
      return ResponseBuilder.data({ mute_until: until }, "mute updated");
    } catch (err) {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async setQuietHours(
    userId: string,
    quiet: {
      enabled?: boolean;
      start_minutes?: number;
      end_minutes?: number;
      timezone?: string;
    }
  ): Promise<ResponseBuilder> {
    try {
      const set: Record<string, unknown> = {};
      if (typeof quiet.enabled === "boolean") {
        set["notifications.quiet_hours.enabled"] = quiet.enabled;
      }
      if (Number.isFinite(quiet.start_minutes)) {
        set["notifications.quiet_hours.start_minutes"] = Math.max(
          0,
          Math.min(24 * 60 - 1, Math.round(quiet.start_minutes!))
        );
      }
      if (Number.isFinite(quiet.end_minutes)) {
        set["notifications.quiet_hours.end_minutes"] = Math.max(
          0,
          Math.min(24 * 60 - 1, Math.round(quiet.end_minutes!))
        );
      }
      if (quiet.timezone) {
        set["notifications.quiet_hours.timezone"] = String(quiet.timezone);
      }
      await user.findByIdAndUpdate(userId, { $set: set });
      const u: any = await user
        .findById(userId)
        .select("notifications.quiet_hours")
        .lean();
      return ResponseBuilder.data(u?.notifications?.quiet_hours ?? {}, "quiet hours updated");
    } catch (err) {
      return ResponseBuilder.errorMessage(l10n.t("ERR_INTERNAL_SERVER"));
    }
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = [
  "messages",
  "bookings",
  "payments",
  "marketing",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Map a logical category → Android notification channel id. Channels are
 * created on the mobile client; the names must line up.
 */
function resolveAndroidChannel(category: string): string {
  switch (category) {
    case "messages":
      return "messages";
    case "bookings":
    case "session_starting":
      return "lessons";
    case "payments":
      return "default";
    case "marketing":
      return "default";
    default:
      return "lessons";
  }
}

/**
 * Read the user's notification prefs and decide whether to drop the
 * push. Returns `{ suppress: boolean, reason }` so callers can log.
 *
 * Order of precedence:
 *   1. `mute_until` in the future  → suppress everything except urgent.
 *   2. Per-channel switch `notifications.channels[cat].push === false`.
 *   3. Inside quiet hours and not in `urgent_categories` → suppress.
 */
export async function shouldSuppressNotification(
  userId: string,
  category: string | undefined,
  urgent: boolean
): Promise<{ suppress: boolean; reason?: string }> {
  try {
    const u: any = await user.findById(userId).select("notifications").lean();
    if (!u) return { suppress: false };
    const prefs = u.notifications || {};

    if (!urgent && prefs.mute_until && new Date(prefs.mute_until).getTime() > Date.now()) {
      return { suppress: true, reason: "muted" };
    }

    const cat = (category || "").toLowerCase();
    if (
      cat &&
      NOTIFICATION_CATEGORIES.includes(cat as NotificationCategory) &&
      prefs.channels &&
      prefs.channels[cat]?.push === false
    ) {
      return { suppress: true, reason: `channel_off:${cat}` };
    }

    if (!urgent && prefs.quiet_hours?.enabled) {
      const now = nowInTimezoneMinutes(prefs.quiet_hours.timezone || "UTC");
      if (isInsideQuietWindow(prefs.quiet_hours.start_minutes, prefs.quiet_hours.end_minutes, now)) {
        const urgentCats: string[] = prefs.quiet_hours.urgent_categories || [];
        if (!cat || !urgentCats.includes(cat)) {
          return { suppress: true, reason: "quiet_hours" };
        }
      }
    }
  } catch (err) {
    if (process.env.PUSH_DEBUG === "1") {
      console.warn("[shouldSuppressNotification] preference lookup failed", err);
    }
  }
  return { suppress: false };
}

/** Returns minutes-from-midnight in the given IANA timezone. */
function nowInTimezoneMinutes(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/**
 * Quiet window is allowed to wrap midnight ("22:00 – 07:00"). We
 * normalise that into two checks.
 */
function isInsideQuietWindow(
  startMin: number,
  endMin: number,
  nowMin: number
): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}