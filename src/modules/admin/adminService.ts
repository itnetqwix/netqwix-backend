import { log } from "../../../logger";
import { Bcrypt } from "../../Utils/bcrypt";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import JWT from "../../Utils/jwt";
import admin_setting from "../../model/default_admin_setting.schema";
import { AccountType } from "../auth/authEnum";
import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import user from "../../model/user.schema";
import booked_session from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import Report from "../../model/report.schema";
import saved_session from "../../model/saved_sessions.schema";
import admin_audit from "../../model/admin_audit.schema";
import mongoose from "mongoose";
import notification from "../../model/notifications.schema";
import onlineUser from "../../model/online_user.schema";
import user_presence from "../../model/user_presence.schema";
import user_activity from "../../model/user_activity.schema";
import raise_concern from "../../model/raise_concern.schema";
import write_us from "../../model/write_us.schema";
import { s3, S3_BUCKET } from "../../Utils/s3Client";
import { getTrainerTraineePresenceSnapshot } from "../socket/socketPresenceRegistry";
import { assertAdminPermission } from "./adminPermission";


export class AdminService {
  public log = log.getLogger();
  public bcrypt = new Bcrypt();
  public JWT = new JWT();

  public async updateGlobalCommission(reqBody: any, authUser: any): Promise<ResponseBuilder> {
    const permErr = assertAdminPermission(authUser, "can_manage_commission");
    if (permErr) return ResponseBuilder.badRequest(permErr);
    const { commission } = reqBody;

    try {
      const adminSetting = await admin_setting.findOneAndUpdate(
        {},
        { commission, last_updated_admin_id: authUser._id },
        { upsert: true, new: true }
      );
      return ResponseBuilder.data(adminSetting, "Commission Updated!");
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getGlobalCommission() {
    try {
      const data = await admin_setting.find();
      return ResponseBuilder.data(data, "Global Commission Fetched!");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  private ensureAdmin(authUser: any): ResponseBuilder | null {
    const at = String(authUser?.account_type ?? "").trim().toLowerCase();
    if (!authUser || at !== String(AccountType.ADMIN).toLowerCase()) {
      return ResponseBuilder.badRequest("Only admin can access this resource");
    }
    return null;
  }

  private resolveCdnBase(): string {
    return (process.env.DATA_CDN_BASE || "https://data.netqwix.com/").replace(/\/?$/, "/");
  }

  private resolveMediaUrl(path?: string | null): string {
    if (!path) return "";
    const s = String(path);
    if (/^https?:\/\//i.test(s)) return s;
    return `${this.resolveCdnBase()}${s.replace(/^\//, "")}`;
  }

  private normalizeLessonSort(sortBy: string): string {
    const allowed = new Set([
      "createdAt",
      "updatedAt",
      "booked_date",
      "status",
      "session_start_time",
      "session_end_time",
      "start_time",
      "end_time",
    ]);
    return allowed.has(sortBy) ? sortBy : "createdAt";
  }

  private normalizeClipSort(sortBy: string): string {
    const allowed = new Set(["createdAt", "updatedAt", "title", "category"]);
    return allowed.has(sortBy) ? sortBy : "createdAt";
  }

  private normalizeReportSort(sortBy: string): string {
    const allowed = new Set(["createdAt", "updatedAt", "title"]);
    return allowed.has(sortBy) ? sortBy : "createdAt";
  }

  private normalizeSavedSort(sortBy: string): string {
    const allowed = new Set(["createdAt", "updatedAt", "title", "file_name"]);
    return allowed.has(sortBy) ? sortBy : "createdAt";
  }

  private normalizeAuditSort(sortBy: string): string {
    const allowed = new Set(["createdAt", "updatedAt", "action", "entity_type"]);
    return allowed.has(sortBy) ? sortBy : "createdAt";
  }

  private getHardDeletePolicy(authUser: any) {
    const envEnabled = String(process.env.ADMIN_HARD_DELETE_ENABLED || "false").toLowerCase() === "true";
    const userPermission = Boolean(
      authUser?.extraInfo?.admin_permissions?.can_hard_delete ||
        authUser?.can_hard_delete
    );
    return {
      hardDeleteEnabled: envEnabled && userPermission,
      envEnabled,
      userPermission,
    };
  }

  private getQueryOptions(query: any) {
    const page = Math.max(1, Number(query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit || 20)));
    const skip = (page - 1) * limit;
    const sortBy = String(query?.sortBy || "createdAt");
    const sortOrder: 1 | -1 =
      String(query?.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
    const search = String(query?.search || "").trim();
    const status = String(query?.status || "").trim();
    return { page, limit, skip, sortBy, sortOrder, search, status };
  }

  private getSortSpec(sortBy: string, sortOrder: 1 | -1): { [key: string]: 1 | -1 } {
    return { [sortBy]: sortOrder };
  }

  public async getUser360(
    authUser: any,
    userId: string,
    includeRaw: string[] = []
  ): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(userId)) return ResponseBuilder.badRequest("Invalid user id");

      const targetUser = await user.findById(userId).lean();
      if (!targetUser) return ResponseBuilder.badRequest("User not found");

      const lessons = await booked_session
        .find({
          $or: [{ trainer_id: userId }, { trainee_id: userId }],
        })
        .populate("trainer_id", "fullname email account_type")
        .populate("trainee_id", "fullname email account_type")
        .sort({ createdAt: -1 })
        .lean();

      const reviews = lessons
        .filter((session: any) => session?.ratings)
        .map((session: any) => ({
          session_id: session?._id,
          booked_date: session?.booked_date,
          status: session?.status,
          ratings: session?.ratings || null,
          trainer: session?.trainer_id || null,
          trainee: session?.trainee_id || null,
        }));

      const clips = await clip
        .find({ user_id: userId, status: true })
        .sort({ createdAt: -1 })
        .lean();

      const reports = await Report.find({
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      })
        .populate("trainer", "fullname email account_type")
        .populate("trainee", "fullname email account_type")
        .populate("sessions", "booked_date status session_start_time session_end_time")
        .sort({ createdAt: -1 })
        .lean();

      const savedSessions = await saved_session.find({
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      })
        .sort({ createdAt: -1 })
        .lean();

      const [notificationsCount, presenceDoc, onlineTrainerRow] = await Promise.all([
        notification.countDocuments({ receiverId: userId }),
        user_presence.findOne({ user_id: userId }).lean(),
        onlineUser.findOne({ trainer_id: userId }).lean(),
      ]);

      const lastSeenCandidates: number[] = [];
      if (presenceDoc?.last_seen_at) lastSeenCandidates.push(new Date(presenceDoc.last_seen_at as any).getTime());
      if (onlineTrainerRow?.last_activity_time) lastSeenCandidates.push(new Date(onlineTrainerRow.last_activity_time as any).getTime());
      const lastOnlineAt =
        lastSeenCandidates.length > 0 ? new Date(Math.max(...lastSeenCandidates)).toISOString() : null;

      const friendsCount = Array.isArray((targetUser as any).friends) ? (targetUser as any).friends.length : 0;

      const overview = {
        identity: {
          fullname: (targetUser as any).fullname,
          email: (targetUser as any).email,
          mobile_no: (targetUser as any).mobile_no,
          account_type: (targetUser as any).account_type,
          status: (targetUser as any).status,
          login_type: (targetUser as any).login_type,
          category: (targetUser as any).category,
          createdAt: (targetUser as any).createdAt,
          updatedAt: (targetUser as any).updatedAt,
        },
        media: {
          profile_picture_url: this.resolveMediaUrl((targetUser as any).profile_picture),
        },
        money: {
          wallet_amount: (targetUser as any).wallet_amount,
          stripe_account_id: (targetUser as any).stripe_account_id,
          is_kyc_completed: (targetUser as any).is_kyc_completed,
          is_registered_with_stript: (targetUser as any).is_registered_with_stript,
          commission: (targetUser as any).commission,
        },
        preferences: {
          notifications: (targetUser as any).notifications,
          extraInfo: (targetUser as any).extraInfo,
        },
        lastOnlineAt,
      };

      const payload: any = {
        user: targetUser,
        overview,
        summary: {
          lessonsCount: lessons.length,
          completedLessonsCount: lessons.filter((l: any) => String(l?.status).toLowerCase() === "completed").length,
          reviewsCount: reviews.length,
          clipsCount: clips.length,
          reportsCount: reports.length,
          savedSessionsCount: savedSessions.length,
          friendsCount,
          notificationsCount,
          lastOnlineAt,
        },
        lessons,
        reviews,
        clips,
        pdfPlans: reports,
        savedSessions,
        policy: this.getHardDeletePolicy(authUser),
      };

      if (!includeRaw.includes("all")) {
        delete payload.user?.password;
      }

      return ResponseBuilder.data(payload, "User 360 data fetched successfully");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getUserLessons(authUser: any, userId: string, query: any = {}): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(userId)) return ResponseBuilder.badRequest("Invalid user id");

      const qo = this.getQueryOptions(query);
      const sortBy = this.normalizeLessonSort(qo.sortBy);
      const { page, limit, skip, sortOrder, search, status } = qo;
      const userScope = { $or: [{ trainer_id: userId }, { trainee_id: userId }] };
      const filters: any[] = [userScope];
      if (status) filters.push({ status });
      if (search && String(search).trim()) {
        const s = String(search).trim();
        filters.push({
          $or: [
            { session_start_time: { $regex: s, $options: "i" } },
            { session_end_time: { $regex: s, $options: "i" } },
            { status: { $regex: s, $options: "i" } },
            { payment_intent_id: { $regex: s, $options: "i" } },
          ],
        });
      }
      const lessonQuery: any = filters.length === 1 ? filters[0] : { $and: filters };
      const lessons = await booked_session
        .find(lessonQuery)
        .populate("trainer_id", "fullname email account_type")
        .populate("trainee_id", "fullname email account_type")
        .sort(this.getSortSpec(sortBy, sortOrder))
        .skip(skip)
        .limit(limit)
        .lean();
      const total = await booked_session.countDocuments(lessonQuery);

      return ResponseBuilder.data({ items: lessons, pagination: { page, limit, total } }, "User lessons fetched successfully");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getUserReviews(authUser: any, userId: string, query: any = {}): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(userId)) return ResponseBuilder.badRequest("Invalid user id");

      const qo = this.getQueryOptions(query);
      const sortBy = this.normalizeLessonSort(qo.sortBy);
      const { page, limit, skip, sortOrder, status, search } = qo;
      const filters: any[] = [{ $or: [{ trainer_id: userId }, { trainee_id: userId }] }, { ratings: { $ne: null } }];
      if (status) filters.push({ status });
      if (search && String(search).trim()) {
        const s = String(search).trim();
        filters.push({
          $or: [{ status: { $regex: s, $options: "i" } }],
        });
      }
      const reviewQuery: any = filters.length === 1 ? filters[0] : { $and: filters };
      const lessons = await booked_session
        .find(reviewQuery)
        .populate("trainer_id", "fullname email account_type")
        .populate("trainee_id", "fullname email account_type")
        .sort(this.getSortSpec(sortBy, sortOrder))
        .skip(skip)
        .limit(limit)
        .lean();
      const total = await booked_session.countDocuments(reviewQuery);

      const reviews = lessons.map((session: any) => ({
        session_id: session?._id,
        booked_date: session?.booked_date,
        status: session?.status,
        ratings: session?.ratings || null,
        trainer: session?.trainer_id || null,
        trainee: session?.trainee_id || null,
      }));

      return ResponseBuilder.data({ items: reviews, pagination: { page, limit, total } }, "User reviews fetched successfully");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getUserAssets(authUser: any, userId: string, query: any = {}): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(userId)) return ResponseBuilder.badRequest("Invalid user id");

      const qo = this.getQueryOptions(query);
      const clipSort = this.normalizeClipSort(qo.sortBy);
      const reportSort = this.normalizeReportSort(qo.sortBy);
      const savedSort = this.normalizeSavedSort(qo.sortBy);
      const { page, limit, skip, sortOrder, search } = qo;
      const section = String(query?.section || "all").toLowerCase();
      const wantClips = section === "all" || section === "clips";
      const wantPlans = section === "all" || section === "plans";

      const clipsQuery: any = { user_id: userId, status: true };
      if (search && String(search).trim()) clipsQuery.title = { $regex: String(search).trim(), $options: "i" };
      const reportsQuery: any = {
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      };
      if (search && String(search).trim()) reportsQuery.title = { $regex: String(search).trim(), $options: "i" };
      const savedQuery: any = {
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      };
      if (search && String(search).trim()) savedQuery.file_name = { $regex: String(search).trim(), $options: "i" };

      const clipPromise = wantClips
        ? clip.find(clipsQuery).sort(this.getSortSpec(clipSort, sortOrder)).skip(skip).limit(limit).lean()
        : Promise.resolve([]);
      const reportsPromise = wantPlans
        ? Report.find(reportsQuery)
            .populate("trainer", "fullname email account_type")
            .populate("trainee", "fullname email account_type")
            .populate("sessions", "booked_date status session_start_time session_end_time")
            .sort(this.getSortSpec(reportSort, sortOrder))
            .skip(skip)
            .limit(limit)
            .lean()
        : Promise.resolve([]);
      const savedPromise = wantPlans
        ? saved_session.find(savedQuery).sort(this.getSortSpec(savedSort, sortOrder)).skip(skip).limit(limit).lean()
        : Promise.resolve([]);
      const clipsCountPromise = wantClips ? clip.countDocuments(clipsQuery) : Promise.resolve(0);
      const reportsCountPromise = wantPlans ? Report.countDocuments(reportsQuery) : Promise.resolve(0);
      const savedCountPromise = wantPlans ? saved_session.countDocuments(savedQuery) : Promise.resolve(0);

      const [clips, reports, savedSessions, clipsTotal, reportsTotal, savedTotal] = await Promise.all([
        clipPromise,
        reportsPromise,
        savedPromise,
        clipsCountPromise,
        reportsCountPromise,
        savedCountPromise,
      ]);

      return ResponseBuilder.data(
        {
          clips: { items: clips, pagination: { page, limit, total: clipsTotal } },
          reports: { items: reports, pagination: { page, limit, total: reportsTotal } },
          savedSessions: { items: savedSessions, pagination: { page, limit, total: savedTotal } },
        },
        "User assets fetched successfully"
      );
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async deleteEntity(
    authUser: any,
    entityType: string,
    entityId: string,
    mode: "soft" | "hard" = "soft",
    reason = ""
  ): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(entityId)) return ResponseBuilder.badRequest("Invalid entity id");

      const normalizedType = String(entityType || "").trim().toLowerCase();
      if (!["clip", "report", "saved_session", "booked_session"].includes(normalizedType)) {
        return ResponseBuilder.badRequest("Unsupported entity type");
      }
      const policy = this.getHardDeletePolicy(authUser);
      if (mode === "hard" && !policy.hardDeleteEnabled) {
        return ResponseBuilder.badRequest("Hard delete is not allowed for this admin account");
      }

      let target: any = null;
      if (normalizedType === "clip") {
        target = mode === "hard" ? await clip.findByIdAndDelete(entityId) : await clip.findByIdAndUpdate(entityId, { $set: { status: false } }, { new: true });
      }
      if (normalizedType === "report") {
        target = mode === "hard" ? await Report.findByIdAndDelete(entityId) : await Report.findByIdAndUpdate(entityId, { $set: { status: false } }, { new: true });
      }
      if (normalizedType === "saved_session") {
        target =
          mode === "hard"
            ? await saved_session.findByIdAndDelete(entityId)
            : await saved_session.findByIdAndUpdate(entityId, { $set: { status: false } }, { new: true });
      }
      if (normalizedType === "booked_session") {
        target =
          mode === "hard"
            ? await booked_session.findByIdAndDelete(entityId)
            : await booked_session.findByIdAndUpdate(
                entityId,
                { $set: { status: "cancelled" } },
                { new: true }
              );
      }

      if (!target) return ResponseBuilder.badRequest("Entity not found");

      if (mode === "soft") {
        const p = authUser?.extraInfo?.admin_permissions;
        if (
          p &&
          typeof p === "object" &&
          Object.keys(p).length > 0 &&
          p.can_soft_delete_entities === false
        ) {
          return ResponseBuilder.badRequest("Soft delete is not allowed for this admin account");
        }
      }

      const auditRow = await admin_audit.create({
        admin_id: authUser?._id,
        target_user_id: (target?.user_id || target?.trainer || target?.trainee || target?.trainer_id || target?.trainee_id || null),
        entity_type: normalizedType,
        entity_id: entityId,
        action: mode === "hard" ? "hard_delete" : "soft_delete",
        reason: reason || "",
        meta: {
          mode,
          entityType: normalizedType,
        },
      });
      const { recordOpsEvent } = require("../ops/opsEventService");
      recordOpsEvent({
        category: "admin",
        severity: "info",
        event_type: auditRow.action,
        user_id: auditRow.target_user_id,
        title: `Admin ${auditRow.action}`,
        summary: auditRow.reason,
        payload: auditRow.meta,
        source: "admin",
        idempotency_key: `admin_audit:${auditRow._id}`,
        source_ref: String(auditRow._id),
        source_collection: "admin_audit",
      });

      return ResponseBuilder.data(
        {
          entityType: normalizedType,
          entityId,
          mode,
        },
        `Entity ${mode === "hard" ? "deleted permanently" : "deleted"} successfully`
      );
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAdminAuditLogs(authUser: any, userId?: string, queryOptions: any = {}): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;

      const qo = this.getQueryOptions(queryOptions);
      const sortBy = this.normalizeAuditSort(qo.sortBy);
      const { page, limit, skip, sortOrder, search } = qo;
      const filters: any[] = [];
      if (userId && mongoose.isValidObjectId(userId)) {
        filters.push({ target_user_id: userId });
      }
      if (search && String(search).trim()) {
        const s = String(search).trim();
        const orClause: any[] = [
          { reason: { $regex: s, $options: "i" } },
          { action: { $regex: s, $options: "i" } },
          { entity_type: { $regex: s, $options: "i" } },
        ];
        if (mongoose.isValidObjectId(s)) {
          orClause.push({ entity_id: new mongoose.Types.ObjectId(s) });
        }
        filters.push({ $or: orClause });
      }
      const query: any = filters.length === 0 ? {} : filters.length === 1 ? filters[0] : { $and: filters };
      const logs = await admin_audit
        .find(query)
        .populate("admin_id", "fullname email account_type")
        .populate("target_user_id", "fullname email account_type")
        .sort(this.getSortSpec(sortBy, sortOrder))
        .skip(skip)
        .limit(limit)
        .lean();
      const total = await admin_audit.countDocuments(query);

      return ResponseBuilder.data({ items: logs, pagination: { page, limit, total } }, "Audit logs fetched successfully");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getUserTimeline(authUser: any, userId: string, query: any = {}): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(userId)) return ResponseBuilder.badRequest("Invalid user id");

      const page = Math.max(1, Number(query?.page || 1));
      const limit = Math.min(100, Math.max(1, Number(query?.limit || 30)));
      const eventTypeRaw = String(query?.eventType || "").trim();
      const typeTokens = eventTypeRaw
        ? eventTypeRaw
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const uid = new mongoose.Types.ObjectId(userId);
      const userBookings = { $or: [{ trainer_id: uid }, { trainee_id: uid }] };
      const cap = 400;

      const [bookings, clipRows, reportRows, savedRows, auditRows, onlineRow, activityRows] = await Promise.all([
        booked_session.find(userBookings).sort({ updatedAt: -1 }).limit(cap).lean(),
        clip.find({ user_id: userId, status: true }).sort({ updatedAt: -1 }).limit(cap).lean(),
        Report.find({ $or: [{ trainer: userId }, { trainee: userId }], status: true }).sort({ updatedAt: -1 }).limit(cap).lean(),
        saved_session.find({ $or: [{ trainer: userId }, { trainee: userId }], status: true }).sort({ updatedAt: -1 }).limit(cap).lean(),
        admin_audit.find({ target_user_id: userId }).sort({ updatedAt: -1 }).limit(cap).lean(),
        onlineUser.findOne({ trainer_id: userId }).lean(),
        user_activity.find({ user_id: userId }).sort({ createdAt: -1 }).limit(cap).lean(),
      ]);

      const items: Array<{ type: string; at: string; title: string; meta: Record<string, unknown> }> = [];

      for (const b of bookings as any[]) {
        const cr = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (cr) {
          items.push({
            type: "booking_created",
            at: new Date(cr).toISOString(),
            title: "Booking created",
            meta: {
              sessionId: String(b._id),
              status: b.status,
              trainer_id: String(b.trainer_id),
              trainee_id: String(b.trainee_id),
            },
          });
        }
        const up = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        if (up && cr && up > cr + 2000) {
          items.push({
            type: "booking_updated",
            at: new Date(up).toISOString(),
            title: "Booking updated",
            meta: { sessionId: String(b._id), status: b.status },
          });
        }
      }

      for (const c of clipRows as any[]) {
        const cr = c.createdAt ? new Date(c.createdAt).getTime() : 0;
        if (cr) {
          items.push({
            type: "clip",
            at: new Date(cr).toISOString(),
            title: `Clip: ${c.title || "Untitled"}`,
            meta: { clipId: String(c._id), title: c.title },
          });
        }
        const up = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
        if (up && cr && up > cr + 2000) {
          items.push({
            type: "clip_updated",
            at: new Date(up).toISOString(),
            title: "Clip updated",
            meta: { clipId: String(c._id) },
          });
        }
      }

      for (const r of reportRows as any[]) {
        const cr = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (cr) {
          items.push({
            type: "report",
            at: new Date(cr).toISOString(),
            title: `Report: ${r.title || "Untitled"}`,
            meta: { reportId: String(r._id) },
          });
        }
      }

      for (const s of savedRows as any[]) {
        const cr = s.createdAt ? new Date(s.createdAt).getTime() : 0;
        if (cr) {
          items.push({
            type: "saved_session",
            at: new Date(cr).toISOString(),
            title: `Saved session: ${s.file_name || s.title || "file"}`,
            meta: { savedSessionId: String(s._id) },
          });
        }
      }

      for (const a of auditRows as any[]) {
        const cr = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        if (cr) {
          items.push({
            type: "admin_audit",
            at: new Date(cr).toISOString(),
            title: `Admin: ${a.action || "action"} (${a.entity_type || "-"})`,
            meta: {
              auditId: String(a._id),
              action: a.action,
              entity_type: a.entity_type,
              entity_id: String(a.entity_id),
              reason: a.reason,
            },
          });
        }
      }

      if (onlineRow?.last_activity_time) {
        items.push({
          type: "trainer_online_snapshot",
          at: new Date(onlineRow.last_activity_time as any).toISOString(),
          title: "Trainer last activity (online_user)",
          meta: { source: "online_user" },
        });
      }

      for (const ev of activityRows as any[]) {
        const cr = ev.createdAt ? new Date(ev.createdAt).getTime() : Date.now();
        items.push({
          type: "user_activity",
          at: new Date(cr).toISOString(),
          title: String(ev.event_type || "activity"),
          meta: { ...(ev.meta || {}), event_type: ev.event_type },
        });
      }

      items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      let filtered = items;
      if (typeTokens.length) {
        filtered = items.filter((it) =>
          typeTokens.some(
            (tok) =>
              it.type.toLowerCase().includes(tok) ||
              String((it.meta as any)?.event_type || "")
                .toLowerCase()
                .includes(tok)
          )
        );
      }

      const total = filtered.length;
      const slice = filtered.slice((page - 1) * limit, page * limit);
      return ResponseBuilder.data({ items: slice, pagination: { page, limit, total } }, "Timeline fetched");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getAdminClipPlayUrl(authUser: any, clipId: string): Promise<ResponseBuilder> {
    try {
      const guard = this.ensureAdmin(authUser);
      if (guard) return guard;
      if (!mongoose.isValidObjectId(clipId)) return ResponseBuilder.badRequest("Invalid clip id");

      const c: any = await clip.findById(clipId).lean();
      if (!c) return ResponseBuilder.badRequest("Clip not found");

      const key =
        (c.file_id && String(c.file_id).trim()) || (c.file_name && String(c.file_name).trim()) || "";
      if (!key) return ResponseBuilder.badRequest("Clip has no file key");

      const cdnVideo = `${this.resolveCdnBase()}${String(key).replace(/^\//, "")}`;
      let videoUrl = cdnVideo;
      let thumbnailUrl = "";

      if (c.thumbnail) {
        const thumbKey = String(c.thumbnail).trim();
        thumbnailUrl = `${this.resolveCdnBase()}${thumbKey.replace(/^\//, "")}`;
      }

      if (S3_BUCKET) {
        try {
          videoUrl = await s3.getSignedUrlPromise("getObject", {
            Bucket: S3_BUCKET,
            Key: key,
            Expires: 900,
          });
          if (c.thumbnail) {
            thumbnailUrl = await s3.getSignedUrlPromise("getObject", {
              Bucket: S3_BUCKET,
              Key: String(c.thumbnail).trim(),
              Expires: 900,
            });
          }
        } catch (e) {
          this.log.info("getAdminClipPlayUrl signed URL failed, using CDN fallback", e);
        }
      }

      return ResponseBuilder.data({ videoUrl, thumbnailUrl, cdnFallbackVideo: cdnVideo }, "Clip URLs resolved");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getDashboardMetrics(authUser: any): Promise<ResponseBuilder> {
    const guard = this.ensureAdmin(authUser);
    if (guard) return guard;
    try {
      const data = await this.buildDashboardMetrics();
      return ResponseBuilder.data(data, "Dashboard metrics fetched");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  public async getOnlineUsers(authUser: any): Promise<ResponseBuilder> {
    const guard = this.ensureAdmin(authUser);
    if (guard) return guard;
    try {
      const users = getTrainerTraineePresenceSnapshot();
      return ResponseBuilder.data(
        { users, updatedAt: Date.now(), source: "socket" },
        "Online users (active socket on this server)"
      );
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

  /** Used by Socket.IO to push updates to admins (server-only). */
  public async getDashboardMetricsInternal(): Promise<any | null> {
    try {
      return await this.buildDashboardMetrics();
    } catch (error) {
      this.log.error("getDashboardMetricsInternal", error);
      return null;
    }
  }

  private async buildDashboardMetrics() {
    const paidMatch: Record<string, unknown> = {
      payment_intent_id: { $exists: true, $nin: [null, ""] },
      status: { $ne: BOOKED_SESSIONS_STATUS.cancel },
    };
    const sessionMatch: Record<string, unknown> = {
      status: { $ne: BOOKED_SESSIONS_STATUS.cancel },
    };

    const openTicketMatch = { ticket_status: { $in: ["open", "in_progress"] } };
    const pendingRefundMatch = {
      status: BOOKED_SESSIONS_STATUS.cancel,
      refund_status: { $ne: "refunded" },
      payment_intent_id: { $exists: true, $nin: [null, ""] },
    };

    const [
      revenueAgg,
      totalOrders,
      totalSessions,
      totalImpressions,
      completedSessions,
      trainersCount,
      traineesCount,
      openSupportTickets,
      openUserFeedback,
      bookingsPendingRefund,
      newUsersLast7Days,
    ] = await Promise.all([
      booked_session.aggregate([
        { $match: paidMatch },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 },
              },
            },
          },
        },
      ]),
      booked_session.countDocuments(paidMatch),
      booked_session.countDocuments(sessionMatch),
      clip.countDocuments({ status: true }),
      booked_session.countDocuments({ status: BOOKED_SESSIONS_STATUS.completed }),
      user.countDocuments({ account_type: AccountType.TRAINER }),
      user.countDocuments({ account_type: AccountType.TRAINEE }),
      raise_concern.countDocuments(openTicketMatch),
      write_us.countDocuments(openTicketMatch),
      booked_session.countDocuments(pendingRefundMatch),
      user.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 86400000) },
        account_type: { $in: [AccountType.TRAINER, AccountType.TRAINEE] },
      }),
    ]);

    const totalRevenue = revenueAgg[0]?.total || 0;
    const overviewCompletionPercent =
      totalSessions > 0 ? Math.min(100, Math.round((completedSessions / totalSessions) * 100)) : 0;

    const { opsBackfillService } = require("../ops/opsBackfillService");
    const opsStats = await opsBackfillService.dashboardStats();

    return {
      totalRevenue,
      totalOrders,
      totalSessions,
      totalImpressions,
      overviewCompletionPercent,
      trainersCount,
      traineesCount,
      bookingsCompleted: completedSessions,
      openSupportTickets,
      openUserFeedback,
      bookingsPendingRefund,
      newUsersLast7Days,
      opsCriticalOpen24h: opsStats.criticalOpen,
      opsInstantFailures24h: opsStats.instantFailures,
      opsCallPreflightFailures24h: opsStats.callPreflightFailures,
    };
  }

}
