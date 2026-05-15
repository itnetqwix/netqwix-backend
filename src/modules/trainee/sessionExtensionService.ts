import mongoose from "mongoose";
import { BOOKED_SESSIONS_STATUS, CONSTANCE } from "../../config/constance";
import { SESSION_EXTENSION } from "../../config/sessionExtension";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { StripeHelper } from "../../helpers/stripe";
import { checkTrainerBookingConflict } from "../../Utils/bookingConflict";
import booked_session from "../../model/booked_sessions.schema";
import user from "../../model/user.schema";
import { DateFormat } from "../../Utils/dateFormat";
import { isAllowedExtensionMinutes } from "./sessionExtensionValidator";

const stripe = require("stripe")(process.env.STRIPE_SECRET);

function getEffectiveEnd(booking: any): Date {
  const ext = booking.extended_end_time ? new Date(booking.extended_end_time) : null;
  const end = booking.end_time ? new Date(booking.end_time) : null;
  if (ext && !Number.isNaN(ext.getTime())) return ext;
  if (end && !Number.isNaN(end.getTime())) return end;
  return new Date(booking.booked_date);
}

function getOriginalDurationMinutes(booking: any): number {
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
  if (!booking.is_instant) {
    return { allowed: false, reason: "Extensions are only available for instant lessons." };
  }
  if (booking.status !== BOOKED_SESSIONS_STATUS.confirm) {
    return { allowed: false, reason: "Session must be confirmed before extending." };
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

      const conflictStart = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.booked_date);
      const conflictEnd = new Date(effectiveEnd.getTime() + minutes * 60 * 1000);
      const conflictMsg = await checkTrainerBookingConflict(
        String(booking.trainer_id),
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
      couponCode?: string;
      customer?: string;
      _userId: string;
      _userType?: string;
    }
  ) {
    try {
      const quoteRes = await this.getQuote(body.sessionId, body.minutes, body._userId);
      if (quoteRes.code !== 200) {
        return quoteRes;
      }
      const quote = quoteRes.result as any;
      if (!quote?.allowed) {
        return ResponseBuilder.badRequest(quote?.reason || "Extension not allowed.", 400);
      }

      const booking = await booked_session
        .findById(body.sessionId)
        .select("trainer_id")
        .lean();
      const trainer = await user
        .findById(booking?.trainer_id)
        .select("stripe_account_id commission")
        .lean();

      return this.stripeHelper.createPaymentIntent({
        amount: quote.amount,
        destination: trainer?.stripe_account_id,
        commission: trainer?.commission ?? "0",
        customer: body.customer,
        couponCode: body.couponCode,
        _userId: body._userId,
        _userType: body._userType || "Trainee",
        _bookingType: "session_extension",
        sessionId: body.sessionId,
        trainer_id: String(booking?.trainer_id),
      });
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }

  public async confirmExtension(
    body: {
      sessionId: string;
      minutes: number;
      payment_intent_id?: string;
      payment_method?: string;
      pin_session_token?: string;
      _userId: string;
    }
  ) {
    try {
      const { sessionId, minutes, payment_intent_id, payment_method, pin_session_token, _userId } =
        body;
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

      const { getLessonTimerSnapshot } = require("../socket/socket.service");
      const timerState = getLessonTimerSnapshot(sessionId);
      const eligibility = validateExtensionEligibility(
        booking.toObject(),
        minutes,
        timerState
      );
      if (!eligibility.allowed) {
        return ResponseBuilder.badRequest(eligibility.reason || "Extension not allowed.", 400);
      }

      let extensionAmount = 0;

      if (payment_method === "wallet") {
        const { walletPaymentService } = require("../wallet/walletPaymentService");
        const trainer = await user
          .findById(booking.trainer_id)
          .select("extraInfo.hourly_rate")
          .lean();
        const hourlyRate = Number(trainer?.extraInfo?.hourly_rate ?? 0);
        extensionAmount = Number(((hourlyRate / 60) * minutes).toFixed(2));
        if (extensionAmount > 0) {
          await walletPaymentService.payFromWallet({
            traineeId: _userId,
            sessionId,
            trainerId: String(booking.trainer_id),
            amountDollars: extensionAmount,
            pinSessionToken: pin_session_token,
            kind: "extension",
            idempotencyKey: `ext:wallet:${sessionId}:${minutes}:${_userId}`,
          });
        }
      } else if (payment_intent_id) {
        const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (intent.status !== "succeeded") {
          return ResponseBuilder.badRequest("Payment has not completed.", 400);
        }
        extensionAmount = Number((intent.amount / 100).toFixed(2));
      } else {
        const trainer = await user
          .findById(booking.trainer_id)
          .select("extraInfo.hourly_rate")
          .lean();
        const hourlyRate = Number(trainer?.extraInfo?.hourly_rate ?? 0);
        extensionAmount = Number(((hourlyRate / 60) * minutes).toFixed(2));
        if (extensionAmount > 0) {
          return ResponseBuilder.badRequest("Payment is required for this extension.", 400);
        }
      }

      const effectiveEnd = getEffectiveEnd(booking);
      const newEnd = new Date(effectiveEnd.getTime() + minutes * 60 * 1000);
      const conflictStart = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.booked_date);

      const conflictMsg = await checkTrainerBookingConflict(
        String(booking.trainer_id),
        conflictStart,
        newEnd,
        String(sessionId)
      );
      if (conflictMsg) {
        return ResponseBuilder.badRequest(conflictMsg, 409);
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

      booking.extensions = [...(booking.extensions || []), extensionEntry];
      booking.total_extended_minutes =
        Number(booking.total_extended_minutes || 0) + minutes;
      booking.extended_end_time = newEnd;
      booking.end_time = newEnd;
      booking.extended_session_end_time = newEndHm;
      booking.session_end_time = newEndHm;
      booking.amount = String(Number((prevAmount + extensionAmount).toFixed(2)));

      await booking.save();

      const { extendLessonTimer } = require("../socket/socket.service");
      extendLessonTimer(sessionId, minutes, {
        endTimeUtc: newEnd.toISOString(),
        extensionId: String((booking.extensions as any[]).length - 1),
      });

      return ResponseBuilder.data(
        {
          booking,
          extension: extensionEntry,
          newEndTimeUtc: newEnd.toISOString(),
        },
        "EXTENSION_APPLIED"
      );
    } catch (err) {
      return ResponseBuilder.error(err, "ERR_INTERNAL_SERVER");
    }
  }
}
