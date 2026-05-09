import { log } from "../../../logger";
import { Bcrypt } from "../../Utils/bcrypt";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import * as l10n from "jm-ez-l10n";
import JWT from "../../Utils/jwt";
import admin_setting from "../../model/default_admin_setting.schema";
import { AccountType } from "../auth/authEnum";
import user from "../../model/user.schema";
import booked_session from "../../model/booked_sessions.schema";
import clip from "../../model/clip.schema";
import Report from "../../model/report.schema";
import saved_session from "../../model/saved_sessions.schema";
import admin_audit from "../../model/admin_audit.schema";
import mongoose from "mongoose";


export class AdminService {
  public log = log.getLogger();
  public bcrypt = new Bcrypt();
  public JWT = new JWT();

  public async updateGlobalCommission(reqBody: any, authUser: any): Promise<ResponseBuilder> {
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
    if (!authUser || authUser?.account_type !== AccountType.ADMIN) {
      return ResponseBuilder.badRequest("Only admin can access this resource");
    }
    return null;
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
    const sortOrder = String(query?.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
    const search = String(query?.search || "").trim();
    const status = String(query?.status || "").trim();
    return { page, limit, skip, sortBy, sortOrder, search, status };
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

      const payload: any = {
        user: targetUser,
        summary: {
          lessonsCount: lessons.length,
          completedLessonsCount: lessons.filter((l: any) => String(l?.status).toLowerCase() === "completed").length,
          reviewsCount: reviews.length,
          clipsCount: clips.length,
          reportsCount: reports.length,
          savedSessionsCount: savedSessions.length,
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

      const { page, limit, skip, sortBy, sortOrder, search, status } = this.getQueryOptions(query);
      const lessonQuery: any = { $or: [{ trainer_id: userId }, { trainee_id: userId }] };
      if (status) lessonQuery.status = status;
      if (search) {
        lessonQuery.$or = [
          { trainer_id: userId },
          { trainee_id: userId },
          { session_start_time: { $regex: search, $options: "i" } },
          { session_end_time: { $regex: search, $options: "i" } },
        ];
      }
      const lessons = await booked_session
        .find(lessonQuery)
        .populate("trainer_id", "fullname email account_type")
        .populate("trainee_id", "fullname email account_type")
        .sort({ [sortBy]: sortOrder })
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

      const { page, limit, skip, sortBy, sortOrder, status } = this.getQueryOptions(query);
      const reviewQuery: any = {
        $or: [{ trainer_id: userId }, { trainee_id: userId }],
        ratings: { $ne: null },
      };
      if (status) reviewQuery.status = status;
      const lessons = await booked_session
        .find(reviewQuery)
        .populate("trainer_id", "fullname email account_type")
        .populate("trainee_id", "fullname email account_type")
        .sort({ [sortBy]: sortOrder })
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

      const { page, limit, skip, sortBy, sortOrder, search } = this.getQueryOptions(query);
      const clipsQuery: any = { user_id: userId, status: true };
      if (search) clipsQuery.title = { $regex: search, $options: "i" };
      const reportsQuery: any = {
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      };
      if (search) reportsQuery.title = { $regex: search, $options: "i" };
      const savedQuery: any = {
        $or: [{ trainer: userId }, { trainee: userId }],
        status: true,
      };
      if (search) savedQuery.file_name = { $regex: search, $options: "i" };

      const [clips, reports, savedSessions, clipsTotal, reportsTotal, savedTotal] = await Promise.all([
        clip.find(clipsQuery).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit).lean(),
        Report.find(reportsQuery)
        .populate("trainer", "fullname email account_type")
        .populate("trainee", "fullname email account_type")
        .populate("sessions", "booked_date status session_start_time session_end_time")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
        saved_session.find(savedQuery).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit).lean(),
        clip.countDocuments(clipsQuery),
        Report.countDocuments(reportsQuery),
        saved_session.countDocuments(savedQuery),
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

      await admin_audit.create({
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

      const query: any = {};
      if (userId && mongoose.isValidObjectId(userId)) {
        query.target_user_id = userId;
      }

      const { page, limit, skip, sortBy, sortOrder } = this.getQueryOptions(queryOptions);
      const logs = await admin_audit
        .find(query)
        .populate("admin_id", "fullname email account_type")
        .populate("target_user_id", "fullname email account_type")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();
      const total = await admin_audit.countDocuments(query);

      return ResponseBuilder.data({ items: logs, pagination: { page, limit, total } }, "Audit logs fetched successfully");
    } catch (error) {
      return ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  }

}
