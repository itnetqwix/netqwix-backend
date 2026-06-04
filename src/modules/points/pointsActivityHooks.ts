import { AccountType } from "../auth/authEnum";
import { pointsService } from "./pointsService";
import type { PointsActionKey } from "../../config/points";

/** Award lesson / booking / review / game-plan points (idempotent per reference). */
export async function onSessionCompletedPoints(booking: {
  _id?: string;
  status?: string;
  trainee_id?: string;
  trainer_id?: string;
}) {
  const bookingId = String(booking._id ?? "");
  if (!bookingId) return;

  if (booking.trainer_id) {
    void pointsService.awardPoints({
      userId: String(booking.trainer_id),
      actionKey: "lesson_completed_trainer",
      points: 3,
      referenceType: "session",
      referenceId: bookingId,
      idempotencyKey: `points:lesson_trainer:${bookingId}`,
    });
  }
  if (booking.trainee_id) {
    void pointsService.awardPoints({
      userId: String(booking.trainee_id),
      actionKey: "lesson_completed_trainee",
      points: 3,
      referenceType: "session",
      referenceId: bookingId,
      idempotencyKey: `points:lesson_trainee:${bookingId}`,
    });
    void pointsService.awardPoints({
      userId: String(booking.trainee_id),
      actionKey: "booking_completed_trainee",
      points: 1,
      referenceType: "session",
      referenceId: `${bookingId}:booked`,
      idempotencyKey: `points:booking_trainee:${bookingId}`,
    });
  }
}

export async function onGamePlanSavedPoints(params: {
  trainerId: string;
  reportId: string;
}) {
  const sessionKey = String(params.reportId);
  void pointsService.awardPoints({
    userId: params.trainerId,
    actionKey: "game_plan_pdf_created",
    points: 5,
    referenceType: "report",
    referenceId: sessionKey,
    idempotencyKey: `points:game_plan:session:${sessionKey}`,
  });
}

export async function onReviewSubmittedPoints(params: {
  traineeId: string;
  bookingId: string;
}) {
  void pointsService.awardPoints({
    userId: params.traineeId,
    actionKey: "review_submitted",
    points: 3,
    referenceType: "review",
    referenceId: params.bookingId,
    idempotencyKey: `points:review:${params.bookingId}`,
  });
}
