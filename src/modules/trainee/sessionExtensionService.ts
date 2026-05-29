import mongoose from "mongoose";
import { BOOKED_SESSIONS_STATUS, CONSTANCE, EVENTS } from "../../config/constance";
import { SESSION_EXTENSION } from "../../config/sessionExtension";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { StripeHelper } from "../../helpers/stripe";
import { checkBothPartiesBookingConflict } from "../../Utils/bookingConflict";
import { INSTANT_BUFFER_AFTER_SESSION_MS } from "../../config/instantLesson";
import { isTrainerInWeeklyAvailabilityNow } from "./instantEligibilityService";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { DateFormat } from "../../Utils/dateFormat";
import { isAllowedExtensionMinutes } from "./sessionExtensionValidator";
import {
  cancelExtensionExpiryJob,
  scheduleExtensionExpiryJob,
} from "../../services/extensionTimerQueue";
import { isRedisEnabled } from "../../services/redisClient";
import { withIdempotency } from "../../services/idempotencyService";
import { invalidateUserSessionsCache } from "../../services/cacheService";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

/** In-process fallback when REDIS_ENABLED=false. */
const extensionRequestTimers = new Map<string, NodeJS.Timeout>();

function clearExtensionTimer(sessionId: string, requestId: string) {
  void cancelExtensionExpiryJob(sessionId, requestId);
  const key = `${sessionId}:${requestId}`;
  const t = extensionRequestTimers.get(key);
  if (t) {
    clearTimeout(t);
    extensionRequestTimers.delete(key);
  }
}

function scheduleExtensionTimer(
  sessionId: string,
  requestId: string,
  delayMs: number,
  reason: string,
  cb: () => Promise<void> | void
) {
  clearExtensionTimer(sessionId, requestId);
  if (isRedisEnabled()) {
    void scheduleExtensionExpiryJob(sessionId, requestId, reason, delayMs);
    if (delayMs <= 0) void cb();
    return;
  }
  if (delayMs <= 0) {
    void cb();
    return;
  }
  const handle = setTimeout(async () => {
    extensionRequestTimers.delete(`${sessionId}:${requestId}`);
    try {
      await cb();
    } catch (err) {
      console.warn("[sessionExtension] auto-timer callback failed", err);
    }
  }, delayMs);
  extensionRequestTimers.set(`${sessionId}:${requestId}`, handle);
}

function findRequestById(booking: any, requestId: string) {
  const list = Array.isArray(booking?.extension_requests)
    ? booking.extension_requests
    : [];
  return list.find((r: any) => String(r._id) === String(requestId)) || null;
}

function asPendingSnapshot(reqDoc: any) {
  if (!reqDoc) return null;
  return {
    requestId: String(reqDoc._id),
    status: reqDoc.status,
    minutes: Number(reqDoc.minutes),
    amount: Number(reqDoc.amount),
    requestedAt: new Date(reqDoc.requested_at).toISOString(),
    expiresAt: reqDoc.expires_at ? new Date(reqDoc.expires_at).toISOString() : null,
    requestedBy: String(reqDoc.requested_by),
  };
}

function getEffectiveEnd(booking: any): Date {
  const ext = booking.extended_end_time ? new Date(booking.extended_end_time) : null;
  const end = booking.end_time ? new Date(booking.end_time) : null;
  if (ext && !Number.isNaN(ext.getTime())) return ext;
  if (end && !Number.isNaN(end.getTime())) return end;
  return new Date(booking.booked_date);
}

function getOriginalDurationMinutes(booking: any): number {
  if (booking.duration_minutes && [15, 30].includes(Number(booking.duration_minutes))) {
    return Number(booking.duration_minutes);
  }
  if (booking.start_time && booking.end_time) {
    const ms =
      new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    if (ms > 0) return Math.floor(ms / 60000);
  }
  return 30;
}

async function loadBookingForTrainee(sessionId: string, traineeId: string) {
  if (!mongoose.isValidObjectId(sessionId)) return null;
  const booking = await booked_session.findById(sessionId).lean();
  if (!booking) return null;
  if (String(booking.trainee_id) !== String(traineeId)) return null;
  return booking;
}

function getTimingWindow(
  booking: any,
  timerState: { remainingSeconds: number; status: string } | null
) {
  const effectiveEnd = getEffectiveEnd(booking);
  const now = Date.now();
  const secondsUntilEnd = Math.floor((effectiveEnd.getTime() - now) / 1000);
  const secondsPastEnd = Math.max(0, -secondsUntilEnd);

  let displayRemaining =
    secondsUntilEnd > 0 ? secondsUntilEnd : 0;
  if (timerState?.remainingSeconds != null) {
    if (timerState.status === "running") {
      displayRemaining = timerState.remainingSeconds;
    } else if (timerState.status === "paused") {
      displayRemaining = timerState.remainingSeconds;
    } else if (timerState.status === "ended") {
      displayRemaining = 0;
    }
  }

  return { displayRemaining, secondsPastEnd, secondsUntilEnd };
}

function validateExtensionEligibility(
  booking: any,
  minutes: number,
  timerState: { remainingSeconds: number; status: string } | null
) {
  if (!isAllowedExtensionMinutes(minutes)) {
    return { allowed: false, reason: "Invalid extension duration." };
  }
  if (booking.status !== BOOKED_SESSIONS_STATUS.confirm) {
    return { allowed: false, reason: "Session must be confirmed before extending." };
  }
  /** Block when another request is still in flight so the trainee can't open
   *  two payment intents for the same pause. The caller is responsible for
   *  surfacing the existing request to the UI. */
  const liveReq = (booking.extension_requests || []).find((r: any) =>
    ["pending", "accepted"].includes(r.status)
  );
  if (liveReq) {
    return {
      allowed: false,
      reason: "An extension request is already in progress for this session.",
      liveRequestId: String(liveReq._id),
    };
  }

  const extensions = Array.isArray(booking.extensions) ? booking.extensions : [];
  const appliedCount = extensions.filter((e: any) => e.status === "applied").length;
  if (appliedCount >= SESSION_EXTENSION.MAX_EXTENSIONS_PER_SESSION) {
    return {
      allowed: false,
      reason: `Maximum ${SESSION_EXTENSION.MAX_EXTENSIONS_PER_SESSION} extensions per session.`,
    };
  }

  const totalExtended = Number(booking.total_extended_minutes || 0);
  const originalMinutes = getOriginalDurationMinutes(booking);
  if (totalExtended + minutes > SESSION_EXTENSION.MAX_TOTAL_DURATION_MINUTES - originalMinutes) {
    return { allowed: false, reason: "Maximum session length reached." };
  }

  const { displayRemaining, secondsPastEnd, secondsUntilEnd } = getTimingWindow(
    booking,
    timerState
  );

  const inPromptWindow =
    secondsUntilEnd <= SESSION_EXTENSION.EXTEND_PROMPT_SECONDS;
  const inGraceWindow =
    secondsUntilEnd <= 0 &&
    secondsPastEnd <= SESSION_EXTENSION.GRACE_SECONDS_AFTER_ZERO;

  if (!inPromptWindow && !inGraceWindow) {
    if (secondsUntilEnd > SESSION_EXTENSION.EXTEND_PROMPT_SECONDS) {
      return {
        allowed: false,
        reason: "Extension is available when 2 minutes or less remain.",
      };
    }
    return {
      allowed: false,
      reason: "Grace period has ended. Please book a new lesson.",
    };
  }

  return {
    allowed: true,
    reason: null as string | null,
    displayRemaining,
  };
}

export class SessionExtensionService {
  private stripeHelper = new StripeHelper();

  public async getQuote(sessionId: string, minutes: number, traineeId: string) {
    try {
      const booking = await loadBookingForTrainee(sessionId, traineeId);
      if (!booking) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }

      const { getLessonTimerSnapshot } = require("../socket/socket.service");
      const timerState = getLessonTimerSnapshot(sessionId);

      const eligibility = validateExtensionEligibility(booking, minutes, timerState);
      if (!eligibility.allowed) {
        return ResponseBuilder.data(
          {
            allowed: false,
            reason: eligibility.reason,
            amount: 0,
            minutes,
          },
          "EXTENSION_QUOTE"
        );
      }

      const trainer = await user
        .findById(booking.trainer_id)
        .select("extraInfo.hourly_rate stripe_account_id commission")
        .lean();
      const hourlyRate = Number(trainer?.extraInfo?.hourly_rate ?? 0);
      const amount = Number(((hourlyRate / 60) * minutes).toFixed(2));

      const effectiveEnd = getEffectiveEnd(booking);
      const newEndTimeUtc = new Date(
        effectiveEnd.getTime() + minutes * 60 * 1000
      ).toISOString();

      /** Both instant and scheduled lessons honor the trainer's weekly availability
       *  — if the proposed extension window crosses outside their schedule, reject
       *  here so the UI doesn't bother the trainer with an impossible request. */
      const avail = await isTrainerInWeeklyAvailabilityNow(
        String(booking.trainer_id),
        new Date()
      );
      if (!avail.ok) {
        return ResponseBuilder.data(
          {
            allowed: false,
            reason: "Coach is outside availability hours; extension not available.",
            amount,
            minutes,
          },
          "EXTENSION_QUOTE"
        );
      }

      const conflictStart = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.booked_date);
      const conflictEnd = new Date(
        effectiveEnd.getTime() +
          minutes * 60 * 1000 +
          INSTANT_BUFFER_AFTER_SESSION_MS
      );
      const conflictMsg = await checkBothPartiesBookingConflict(
        String(booking.trainer_id),
        String(booking.trainee_id),
        conflictStart,
        conflictEnd,
        String(sessionId)
      );

      if (conflictMsg) {
        return ResponseBuilder.data(
          {
            allowed: false,
            reason: conflictMsg,
            amount,
            minutes,
            newEndTimeUtc,
          },
          "EXTENSION_QUOTE"
        );
      }

      return ResponseBuilder.data(
        {
          allowed: true,
          amount,
          minutes,
          newEndTimeUtc,
          hourlyRate,
          trainerStripeId: trainer?.stripe_account_id ?? null,
          commission: trainer?.commission ?? "0",
          remainingSeconds: timerState?.remainingSeconds ?? null,
        },
        "EXTENSION_QUOTE"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async createPaymentIntent(
    body: {
      sessionId: string;
      minutes: number;
      requestId?: string;
      couponCode?: string;
      customer?: string;
      _userId: string;
      _userType?: string;
    }
  ) {
    try {
      const booking = await booked_session
        .findById(body.sessionId)
        .select("trainer_id trainee_id extension_requests")
        .lean();
      if (!booking || String(booking.trainee_id) !== String(body._userId)) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }

      let approvedAmount: number | null = null;

      if (body.requestId) {
        const reqDoc = findRequestById(booking, body.requestId);
        if (!reqDoc) {
          return ResponseBuilder.badRequest("Extension request not found.", 404);
        }
        if (String(reqDoc.requested_by) !== String(body._userId)) {
          return ResponseBuilder.badRequest("Extension request not found.", 404);
        }
        if (reqDoc.status !== "accepted") {
          return ResponseBuilder.badRequest(
            `Extension request is ${reqDoc.status}; cannot start payment.`,
            400
          );
        }
        if (reqDoc.expires_at && new Date(reqDoc.expires_at) < new Date()) {
          return ResponseBuilder.badRequest(
            "Extension request expired before payment started.",
            400
          );
        }
        if (Number(reqDoc.minutes) !== Number(body.minutes)) {
          return ResponseBuilder.badRequest(
            "Minutes do not match the approved extension request.",
            400
          );
        }
        approvedAmount = Number(reqDoc.amount);
        if (reqDoc.payment_intent_id) {
          try {
            const existing = await stripe.paymentIntents.retrieve(reqDoc.payment_intent_id);
            if (existing?.client_secret) {
              return ResponseBuilder.data(
                {
                  client_secret: existing.client_secret,
                  id: existing.id,
                  amount: existing.amount,
                  idempotent: true,
                },
                "EXTENSION_PAYMENT_INTENT"
              );
            }
          } catch {
            /* create a fresh PI below */
          }
        }
      } else {
        const quoteRes = await this.getQuote(body.sessionId, body.minutes, body._userId);
        if (quoteRes.code !== 200) {
          return quoteRes;
        }
        const quote = quoteRes.result as any;
        if (!quote?.allowed) {
          return ResponseBuilder.badRequest(quote?.reason || "Extension not allowed.", 400);
        }
        approvedAmount = Number(quote.amount);
      }

      const trainer = await user
        .findById(booking.trainer_id)
        .select("stripe_account_id commission")
        .lean();

      const { broadcastSessionExtensionEvent } = require("../socket/socket.service");
      if (body.requestId) {
        broadcastSessionExtensionEvent(
          String(body.sessionId),
          EVENTS.SESSION_EXTENSION.PAYMENT_STARTED,
          { requestId: String(body.requestId), minutes: body.minutes }
        );
      }

      const piRes = await this.stripeHelper.createPaymentIntent({
        amount: approvedAmount,
        destination: trainer?.stripe_account_id,
        commission: trainer?.commission ?? "0",
        customer: body.customer,
        couponCode: body.couponCode,
        _userId: body._userId,
        _userType: body._userType || "Trainee",
        _bookingType: "session_extension",
        sessionId: body.sessionId,
        trainer_id: String(booking.trainer_id),
      });

      if (body.requestId && piRes.code === 200) {
        const piId = (piRes.result as { id?: string })?.id;
        if (piId) {
          await booked_session.updateOne(
            {
              _id: body.sessionId,
              "extension_requests._id": new mongoose.Types.ObjectId(String(body.requestId)),
            },
            { $set: { "extension_requests.$.payment_intent_id": piId } }
          );
        }
      }

      return piRes;
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async confirmExtension(
    body: {
      sessionId: string;
      minutes: number;
      requestId?: string;
      payment_intent_id?: string;
      payment_method?: string;
      pin_session_token?: string;
      _userId: string;
    }
  ) {
    const idemKey =
      body.payment_intent_id && body.sessionId
        ? `extension-confirm:${body.sessionId}:${body.payment_intent_id}`
        : body.payment_method === "wallet" && body.requestId && body.sessionId
          ? `extension-confirm:wallet:${body.sessionId}:${body.requestId}`
          : null;
    if (idemKey) {
      try {
        return await withIdempotency(idemKey, () => this.confirmExtensionCore(body));
      } catch (err: any) {
        if (err?.message === "IDEMPOTENCY_IN_PROGRESS") {
          return ResponseBuilder.badRequest(
            "Payment confirmation already in progress.",
            409
          );
        }
        throw err;
      }
    }
    return this.confirmExtensionCore(body);
  }

  private async confirmExtensionCore(
    body: {
      sessionId: string;
      minutes: number;
      requestId?: string;
      payment_intent_id?: string;
      payment_method?: string;
      pin_session_token?: string;
      _userId: string;
    }
  ) {
    try {
      const { sessionId, minutes, requestId, payment_method, pin_session_token, _userId } =
        body;
      let payment_intent_id = body.payment_intent_id as string | undefined;
      const booking = await booked_session.findById(sessionId);
      if (!booking || String(booking.trainee_id) !== String(_userId)) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }

      const existingApplied = (booking.extensions || []).find(
        (e: any) =>
          e.payment_intent_id &&
          payment_intent_id &&
          String(e.payment_intent_id) === String(payment_intent_id) &&
          e.status === "applied"
      );
      if (existingApplied) {
        return ResponseBuilder.data(
          { booking, extension: existingApplied, idempotent: true },
          "EXTENSION_APPLIED"
        );
      }

      /** When the new request-based workflow is used, verify the request was
       *  accepted by the trainer and not expired/cancelled before we charge or
       *  apply the extension. */
      let approvedRequest: any = null;
      if (requestId) {
        approvedRequest = findRequestById(booking, requestId);
        if (!approvedRequest) {
          return ResponseBuilder.badRequest("Extension request not found.", 404);
        }
        if (String(approvedRequest.requested_by) !== String(_userId)) {
          return ResponseBuilder.badRequest("Extension request not found.", 404);
        }
        const paidButUnapplied =
          approvedRequest.status === "paid" &&
          (approvedRequest.extension_index == null ||
            booking.extensions?.[approvedRequest.extension_index]?.status !==
              "applied");
        if (approvedRequest.status === "paid" && !paidButUnapplied) {
          return ResponseBuilder.data(
            { booking, idempotent: true },
            "EXTENSION_APPLIED"
          );
        }
        if (approvedRequest.status !== "accepted" && !paidButUnapplied) {
          return ResponseBuilder.badRequest(
            `Extension request is ${approvedRequest.status}; cannot confirm.`,
            400
          );
        }
        if (
          !paidButUnapplied &&
          approvedRequest.expires_at &&
          new Date(approvedRequest.expires_at) < new Date()
        ) {
          return ResponseBuilder.badRequest(
            "Extension request expired before payment completed.",
            400
          );
        }
        if (Number(approvedRequest.minutes) !== Number(minutes)) {
          return ResponseBuilder.badRequest(
            "Minutes do not match the approved extension request.",
            400
          );
        }
      }

      const { getLessonTimerSnapshot } = require("../socket/socket.service");
      const timerState = getLessonTimerSnapshot(sessionId);
      /** When a `requestId` is provided we already validated eligibility at
       *  `createRequest` time and the timer has been paused since; skip the
       *  re-check so the in-window/grace gate doesn't trip after the pause. */
      if (!approvedRequest) {
        const eligibility = validateExtensionEligibility(
          booking.toObject(),
          minutes,
          timerState
        );
        if (!eligibility.allowed) {
          return ResponseBuilder.badRequest(eligibility.reason || "Extension not allowed.", 400);
        }
      } else if (!isAllowedExtensionMinutes(minutes)) {
        return ResponseBuilder.badRequest("Invalid extension duration.", 400);
      }

      const trainerForRate = await user
        .findById(booking.trainer_id)
        .select("extraInfo.hourly_rate")
        .lean();
      const hourlyRate = Number(trainerForRate?.extraInfo?.hourly_rate ?? 0);
      let extensionAmount = Number(((hourlyRate / 60) * minutes).toFixed(2));

      const effectiveEnd = getEffectiveEnd(booking);
      const newEnd = new Date(effectiveEnd.getTime() + minutes * 60 * 1000);
      const conflictStart = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.booked_date);

      const conflictEnd = new Date(newEnd.getTime() + INSTANT_BUFFER_AFTER_SESSION_MS);
      const conflictMsg = await checkBothPartiesBookingConflict(
        String(booking.trainer_id),
        String(booking.trainee_id),
        conflictStart,
        conflictEnd,
        String(sessionId)
      );
      if (conflictMsg) {
        return ResponseBuilder.badRequest(conflictMsg, 409);
      }

      const walletIdempotencyKey = requestId
        ? `ext:wallet:${sessionId}:${requestId}`
        : `ext:wallet:${sessionId}:${minutes}:${_userId}`;

      const skipChargeBecausePaid =
        !!approvedRequest && approvedRequest.status === "paid";

      if (skipChargeBecausePaid) {
        extensionAmount = Number(approvedRequest.amount ?? extensionAmount);
        payment_intent_id =
          payment_intent_id || approvedRequest.payment_intent_id || undefined;
      } else if (payment_method === "wallet") {
        const { walletPaymentService } = require("../wallet/walletPaymentService");
        if (extensionAmount > 0) {
          await walletPaymentService.payFromWallet({
            traineeId: _userId,
            sessionId,
            trainerId: String(booking.trainer_id),
            amountDollars: extensionAmount,
            pinSessionToken: pin_session_token,
            kind: "extension",
            idempotencyKey: walletIdempotencyKey,
          });
        }
      } else if (payment_intent_id) {
        const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (intent.status !== "succeeded") {
          return ResponseBuilder.badRequest("Payment has not completed.", 400);
        }
        extensionAmount = Number((intent.amount / 100).toFixed(2));
      } else if (extensionAmount > 0) {
        return ResponseBuilder.badRequest("Payment is required for this extension.", 400);
      }

      const newEndHm = DateFormat.addMinutes(
        effectiveEnd,
        minutes,
        CONSTANCE.INSTANT_MEETING_TIME_FORMAT
      );

      const prevAmount = Number(booking.amount || 0);
      const extensionEntry = {
        minutes,
        amount: extensionAmount,
        payment_intent_id: payment_intent_id || null,
        status: "applied",
        requested_at: new Date(),
        applied_at: new Date(),
        requested_by: _userId,
      };

      const reapplyPaidExtension =
        !!approvedRequest && approvedRequest.status === "paid";
      const reapplyInPlace =
        reapplyPaidExtension && approvedRequest.extension_index != null;

      let extensionIndex: number;
      if (reapplyInPlace) {
        extensionIndex = Number(approvedRequest.extension_index);
        const arr = [...(booking.extensions || [])];
        while (arr.length <= extensionIndex) {
          arr.push(undefined as any);
        }
        arr[extensionIndex] = extensionEntry;
        booking.extensions = arr;
      } else {
        booking.extensions = [...(booking.extensions || []), extensionEntry];
        extensionIndex = (booking.extensions as any[]).length - 1;
        booking.total_extended_minutes =
          Number(booking.total_extended_minutes || 0) + minutes;
        booking.amount = String(Number((prevAmount + extensionAmount).toFixed(2)));
      }
      booking.extended_end_time = newEnd;
      booking.end_time = newEnd;
      booking.extended_session_end_time = newEndHm;
      booking.session_end_time = newEndHm;

      if (requestId) {
        const reqDoc = (booking.extension_requests as any).id?.(requestId)
          || findRequestById(booking, requestId);
        if (reqDoc) {
          reqDoc.status = "paid";
          reqDoc.payment_intent_id = payment_intent_id || reqDoc.payment_intent_id;
          reqDoc.extension_index = extensionIndex;
          reqDoc.decided_at = reqDoc.decided_at ?? new Date();
        }
        clearExtensionTimer(String(sessionId), String(requestId));
      }

      try {
        await booking.save();
      } catch (saveErr) {
        if (payment_method === "wallet" && extensionAmount > 0) {
          try {
            const { walletPaymentService } = require("../wallet/walletPaymentService");
            await walletPaymentService.refundWalletPaymentForSession({
              sessionId,
              traineeId: _userId,
              kind: "extension",
              idempotencyKey: walletIdempotencyKey,
              reason: "extension_save_failed",
            });
          } catch (rollbackErr) {
            console.warn("[sessionExtension] wallet rollback failed", rollbackErr);
          }
        }
        throw saveErr;
      }

      const { extendLessonTimer, setPendingExtensionRequest, broadcastSessionExtensionEvent } =
        require("../socket/socket.service");
      extendLessonTimer(sessionId, minutes, {
        endTimeUtc: newEnd.toISOString(),
        extensionId: String(extensionIndex),
      });
      setPendingExtensionRequest(sessionId, null);
      broadcastSessionExtensionEvent(
        String(sessionId),
        EVENTS.SESSION_EXTENSION.APPLIED,
        {
          requestId: requestId ? String(requestId) : null,
          minutes,
          amount: extensionAmount,
          newEndTimeUtc: newEnd.toISOString(),
          extensionIndex,
        }
      );

      void invalidateUserSessionsCache(String(booking.trainee_id));
      void invalidateUserSessionsCache(String(booking.trainer_id));

      return ResponseBuilder.data(
        {
          booking,
          extension: extensionEntry,
          newEndTimeUtc: newEnd.toISOString(),
          requestId: requestId ? String(requestId) : null,
        },
        "EXTENSION_APPLIED"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  /**
   * Trainee asks the trainer to extend the lesson. Validates eligibility,
   * creates a `pending` row, pauses the timer with reason `extension_pending`
   * and broadcasts `SESSION_EXTENSION_REQUESTED`. Schedules an auto-reject
   * timer so the timer can resume even if the trainer never answers.
   */
  public async createRequest(body: {
    sessionId: string;
    minutes: number;
    _userId: string;
  }) {
    try {
      const { sessionId, minutes, _userId } = body;
      if (!mongoose.isValidObjectId(sessionId)) {
        return ResponseBuilder.badRequest("Invalid session id.", 400);
      }
      if (!isAllowedExtensionMinutes(minutes)) {
        return ResponseBuilder.badRequest("Invalid extension duration.", 400);
      }

      const existingBooking = await booked_session.findById(sessionId);
      if (!existingBooking || String(existingBooking.trainee_id) !== String(_userId)) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }

      const { getLessonTimerSnapshot } = require("../socket/socket.service");
      const timerState = getLessonTimerSnapshot(sessionId);
      const eligibility = validateExtensionEligibility(
        existingBooking.toObject(),
        minutes,
        timerState
      );
      if (!eligibility.allowed) {
        if ((eligibility as any).liveRequestId) {
          const existing = findRequestById(existingBooking, (eligibility as any).liveRequestId);
          if (existing) {
            return ResponseBuilder.data(
              {
                allowed: false,
                reason: eligibility.reason,
                request: asPendingSnapshot(existing),
              },
              "EXTENSION_REQUEST_EXISTS"
            );
          }
        }
        return ResponseBuilder.badRequest(eligibility.reason || "Extension not allowed.", 400);
      }

      /** Don't bother the trainer with an unbookable extension — surface the
       *  schedule conflict / availability issue up front so the trainee can
       *  pick a different duration or wait. */
      const availability = await isTrainerInWeeklyAvailabilityNow(
        String(existingBooking.trainer_id),
        new Date()
      );
      if (!availability.ok) {
        return ResponseBuilder.badRequest(
          "Coach is outside availability hours; extension not available.",
          400
        );
      }

      const effectiveEnd = getEffectiveEnd(existingBooking);
      const proposedEnd = new Date(effectiveEnd.getTime() + minutes * 60 * 1000);
      const conflictStart = existingBooking.start_time
        ? new Date(existingBooking.start_time)
        : new Date(existingBooking.booked_date);
      const conflictEnd = new Date(
        proposedEnd.getTime() + INSTANT_BUFFER_AFTER_SESSION_MS
      );
      const conflictMsg = await checkBothPartiesBookingConflict(
        String(existingBooking.trainer_id),
        String(existingBooking.trainee_id),
        conflictStart,
        conflictEnd,
        String(sessionId)
      );
      if (conflictMsg) {
        return ResponseBuilder.badRequest(conflictMsg, 409);
      }

      const trainer = await user
        .findById(existingBooking.trainer_id)
        .select("extraInfo.hourly_rate")
        .lean();
      const hourlyRate = Number(trainer?.extraInfo?.hourly_rate ?? 0);
      const amount = Number(((hourlyRate / 60) * minutes).toFixed(2));

      const expiresAt = new Date(
        Date.now() + SESSION_EXTENSION.REQUEST_AUTO_REJECT_SECONDS * 1000
      );

      const newRequestDoc = {
        minutes,
        amount,
        status: "pending",
        requested_by: _userId,
        requested_at: new Date(),
        expires_at: expiresAt,
      };

      const updatedBooking = await booked_session.findOneAndUpdate(
        {
          _id: sessionId,
          trainee_id: _userId,
          $or: [
            { extension_requests: { $exists: false } },
            { extension_requests: { $size: 0 } },
            {
              extension_requests: {
                $not: {
                  $elemMatch: { status: { $in: ["pending", "accepted"] } },
                },
              },
            },
          ],
        },
        { $push: { extension_requests: newRequestDoc } },
        { new: true }
      );

      if (!updatedBooking) {
        const again = await booked_session.findById(sessionId);
        const live = (again?.extension_requests || []).find((r: any) =>
          ["pending", "accepted"].includes(String(r.status))
        );
        if (live) {
          return ResponseBuilder.data(
            { allowed: false, reason: "Extension request already in progress.", request: asPendingSnapshot(live) },
            "EXTENSION_REQUEST_EXISTS"
          );
        }
        return ResponseBuilder.badRequest("Could not create extension request.", 409);
      }

      const newReq = (updatedBooking.extension_requests as any[])[
        (updatedBooking.extension_requests as any[]).length - 1
      ];
      const booking = updatedBooking;
      const {
        pauseLessonTimer,
        setPendingExtensionRequest,
        broadcastSessionExtensionEvent,
      } = require("../socket/socket.service");

      pauseLessonTimer(String(sessionId), "extension_pending");
      const snapshot = asPendingSnapshot(newReq);
      setPendingExtensionRequest(String(sessionId), snapshot);
      broadcastSessionExtensionEvent(
        String(sessionId),
        EVENTS.SESSION_EXTENSION.REQUESTED,
        {
          request: snapshot,
          trainerId: String(booking.trainer_id),
          traineeId: String(booking.trainee_id),
        }
      );

      scheduleExtensionTimer(
        String(sessionId),
        String(newReq._id),
        SESSION_EXTENSION.REQUEST_AUTO_REJECT_SECONDS * 1000,
        "trainer_offline_timeout",
        () => this.expireRequest(String(sessionId), String(newReq._id), "trainer_offline_timeout")
      );

      return ResponseBuilder.data(
        { request: snapshot },
        "EXTENSION_REQUESTED"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  /**
   * Trainer responds to a pending request. On `accept` the request flips to
   * `accepted`, the pause reason becomes `extension_accepted`, and a fresh
   * `expires_at` is set so the trainee has a bounded payment window. On
   * `reject` the request is closed and the timer resumes immediately.
   */
  public async respondToRequest(body: {
    sessionId: string;
    requestId: string;
    decision: "accept" | "reject";
    _userId: string;
  }) {
    try {
      const { sessionId, requestId, decision, _userId } = body;
      const booking = await booked_session.findById(sessionId);
      if (!booking) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }
      if (String(booking.trainer_id) !== String(_userId)) {
        return ResponseBuilder.badRequest("Only the trainer can respond.", 403);
      }
      const reqDoc = findRequestById(booking, requestId);
      if (!reqDoc) {
        return ResponseBuilder.badRequest("Extension request not found.", 404);
      }
      if (reqDoc.status !== "pending") {
        return ResponseBuilder.badRequest(
          `Extension request is ${reqDoc.status}; cannot respond.`,
          400
        );
      }

      clearExtensionTimer(String(sessionId), String(requestId));

      reqDoc.decided_by = _userId;
      reqDoc.decided_at = new Date();

      const {
        resumeLessonTimer,
        setPendingExtensionRequest,
        broadcastSessionExtensionEvent,
        pauseLessonTimer,
      } = require("../socket/socket.service");

      if (decision === "reject") {
        reqDoc.status = "rejected";
        reqDoc.terminal_reason = "trainer_rejected";
        await booking.save();
        setPendingExtensionRequest(String(sessionId), null);
        resumeLessonTimer(String(sessionId), "extension_rejected");
        broadcastSessionExtensionEvent(
          String(sessionId),
          EVENTS.SESSION_EXTENSION.REJECTED,
          { requestId: String(requestId), reason: "trainer_rejected" }
        );
        return ResponseBuilder.data(
          { request: asPendingSnapshot(reqDoc) },
          "EXTENSION_REJECTED"
        );
      }

      // accept
      reqDoc.status = "accepted";
      const newExpiry = new Date(
        Date.now() + SESSION_EXTENSION.PAYMENT_WINDOW_SECONDS * 1000
      );
      reqDoc.expires_at = newExpiry;
      await booking.save();

      const snapshot = asPendingSnapshot(reqDoc);
      // Keep the timer paused but flip the reason so the UI can show
      // "Awaiting payment from trainee" rather than "Awaiting trainer".
      pauseLessonTimer(String(sessionId), "extension_accepted");
      setPendingExtensionRequest(String(sessionId), snapshot);
      broadcastSessionExtensionEvent(
        String(sessionId),
        EVENTS.SESSION_EXTENSION.ACCEPTED,
        { request: snapshot }
      );

      scheduleExtensionTimer(
        String(sessionId),
        String(reqDoc._id),
        SESSION_EXTENSION.PAYMENT_WINDOW_SECONDS * 1000,
        "payment_window_elapsed",
        () => this.expireRequest(String(sessionId), String(reqDoc._id), "payment_window_elapsed")
      );

      return ResponseBuilder.data(
        { request: snapshot },
        "EXTENSION_ACCEPTED"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  /**
   * Either party (trainee explicitly, or backend on payment failure) cancels
   * a request that is still `pending` or `accepted`. Always resumes the timer.
   */
  public async cancelRequest(body: {
    sessionId: string;
    requestId: string;
    reason?: string;
    _userId: string;
  }) {
    try {
      const { sessionId, requestId, reason, _userId } = body;
      const booking = await booked_session.findById(sessionId);
      if (!booking) {
        return ResponseBuilder.badRequest("Session not found.", 404);
      }
      const reqDoc = findRequestById(booking, requestId);
      if (!reqDoc) {
        return ResponseBuilder.badRequest("Extension request not found.", 404);
      }
      const isParticipant =
        String(booking.trainee_id) === String(_userId) ||
        String(booking.trainer_id) === String(_userId);
      if (!isParticipant) {
        return ResponseBuilder.badRequest("Not a participant of this session.", 403);
      }
      if (!["pending", "accepted"].includes(reqDoc.status)) {
        return ResponseBuilder.data(
          { request: asPendingSnapshot(reqDoc) },
          "EXTENSION_ALREADY_TERMINAL"
        );
      }

      clearExtensionTimer(String(sessionId), String(requestId));
      reqDoc.status = "cancelled";
      reqDoc.decided_by = _userId;
      reqDoc.decided_at = new Date();
      reqDoc.terminal_reason = reason || "user_cancelled";
      await booking.save();

      const {
        resumeLessonTimer,
        setPendingExtensionRequest,
        broadcastSessionExtensionEvent,
      } = require("../socket/socket.service");

      setPendingExtensionRequest(String(sessionId), null);
      resumeLessonTimer(String(sessionId), "extension_cancelled");
      broadcastSessionExtensionEvent(
        String(sessionId),
        EVENTS.SESSION_EXTENSION.CANCELLED,
        { requestId: String(requestId), reason: reqDoc.terminal_reason }
      );

      return ResponseBuilder.data(
        { request: asPendingSnapshot(reqDoc) },
        "EXTENSION_CANCELLED"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  /** Internal helper used by the auto-reject / payment-window timers. */
  public async expireRequest(
    sessionId: string,
    requestId: string,
    reason: string
  ) {
    try {
      const reqOid = new mongoose.Types.ObjectId(String(requestId));
      const booking = await booked_session.findOneAndUpdate(
        {
          _id: sessionId,
          extension_requests: {
            $elemMatch: {
              _id: reqOid,
              status: { $in: ["pending", "accepted"] },
            },
          },
        },
        {
          $set: {
            "extension_requests.$[elem].status": "expired",
            "extension_requests.$[elem].terminal_reason": reason,
            "extension_requests.$[elem].decided_at": new Date(),
          },
        },
        {
          arrayFilters: [
            {
              "elem._id": reqOid,
              "elem.status": { $in: ["pending", "accepted"] },
            },
          ],
          new: true,
        }
      );
      if (!booking) return;

      const reqDoc = findRequestById(booking, requestId);
      if (!reqDoc || reqDoc.status !== "expired") return;

      if (reqDoc.payment_intent_id || Number(reqDoc.amount) > 0) {
        try {
          const { walletPaymentService } = require("../wallet/walletPaymentService");
          await walletPaymentService.refundWalletPaymentForSession({
            sessionId: String(sessionId),
            traineeId: String(reqDoc.requested_by),
            kind: "extension",
            idempotencyKey: `ext:wallet:${sessionId}:${requestId}`,
            reason: `extension_expired:${reason}`,
          });
        } catch (refundErr) {
          console.warn("[sessionExtension] expire refund failed", refundErr);
        }
      }

      const {
        resumeLessonTimer,
        setPendingExtensionRequest,
        broadcastSessionExtensionEvent,
      } = require("../socket/socket.service");

      setPendingExtensionRequest(String(sessionId), null);
      resumeLessonTimer(String(sessionId), `extension_expired:${reason}`);
      broadcastSessionExtensionEvent(
        String(sessionId),
        EVENTS.SESSION_EXTENSION.EXPIRED,
        { requestId, reason }
      );
    } catch (err) {
      console.warn("[sessionExtension] expireRequest failed", err);
    }
  }
}

/**
 * Cron: finish extension requests that were paid (or PI succeeded) but never
 * fully applied to the booking / lesson timer.
 */
export async function reconcilePaidUnappliedExtensions(): Promise<{
  scanned: number;
  applied: number;
  errors: number;
  refunded: number;
  skipped: number;
}> {
  const { isExtensionWalletSettled } = require("./extensionWalletSettled");
  const service = new SessionExtensionService();
  let scanned = 0;
  let applied = 0;
  let errors = 0;
  let refunded = 0;
  let skipped = 0;

  const cursor = booked_session
    .find({
      extension_requests: {
        $elemMatch: {
          $or: [
            { status: "accepted" },
            {
              status: "paid",
              $or: [
                { extension_index: { $exists: false } },
                { extension_index: null },
              ],
            },
            {
              status: "paid",
              extension_index: { $exists: true, $ne: null },
            },
          ],
        },
      },
    })
    .select("_id extension_requests extensions trainee_id")
    .limit(50)
    .cursor();

  for await (const doc of cursor) {
    const sessionId = String(doc._id);
    for (const req of doc.extension_requests || []) {
      const requestId = String(req._id);
      const status = String(req.status || "");
      const piId = req.payment_intent_id ? String(req.payment_intent_id) : "";

      if (status === "paid") {
        const idx = req.extension_index;
        const ext =
          idx != null && doc.extensions?.[idx]
            ? doc.extensions[idx]
            : null;
        if (ext?.status === "applied") continue;
      } else if (status !== "accepted") {
        continue;
      }

      let useWallet = false;
      let paymentReady = false;
      if (status === "accepted") {
        if (piId) {
          try {
            const intent = await stripe.paymentIntents.retrieve(piId);
            paymentReady = intent.status === "succeeded";
          } catch {
            paymentReady = false;
          }
        } else {
          useWallet = await isExtensionWalletSettled(sessionId, requestId);
          paymentReady = useWallet;
        }
        if (!paymentReady) {
          skipped += 1;
          continue;
        }
      }

      scanned += 1;
      try {
        const res = await service.confirmExtension({
          sessionId,
          minutes: Number(req.minutes),
          requestId,
          payment_intent_id: useWallet ? undefined : piId || undefined,
          payment_method: useWallet ? "wallet" : undefined,
          _userId: String(req.requested_by),
        });
        if (res?.code === 200 || res?.code === 201) {
          applied += 1;
        } else if (res?.code === 409) {
          if (useWallet) {
            try {
              const { walletPaymentService } = require("../wallet/walletPaymentService");
              const rb = await walletPaymentService.refundWalletPaymentForSession({
                sessionId,
                traineeId: String(req.requested_by),
                kind: "extension",
                idempotencyKey: `ext:wallet:${sessionId}:${requestId}`,
                reason: "extension_reconcile_conflict",
              });
              if (rb?.refunded) refunded += 1;
            } catch (refundErr) {
              console.warn("[extensionReconcile] wallet refund failed", refundErr);
            }
          } else if (piId) {
            try {
              const {
                refundExtensionStripePaymentIntent,
              } = require("./extensionStripeRefund");
              const rb = await refundExtensionStripePaymentIntent({
                sessionId,
                requestId,
                paymentIntentId: piId,
                reason: "extension_reconcile_conflict",
              });
              if (rb?.refunded) refunded += 1;
            } catch (refundErr) {
              console.warn("[extensionReconcile] stripe refund failed", refundErr);
            }
          }
          errors += 1;
        } else if (res?.code && res.code >= 400) {
          errors += 1;
        }
      } catch (err) {
        errors += 1;
        console.warn(
          `[extensionReconcile] session=${sessionId} request=${requestId}`,
          err
        );
      }
    }
  }

  if (scanned > 0 || errors > 0) {
    console.log(
      `[extensionReconcile] scanned=${scanned} applied=${applied} errors=${errors} refunded=${refunded} skipped=${skipped}`
    );
  }
  return { scanned, applied, errors, refunded, skipped };
}
