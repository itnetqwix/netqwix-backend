# Platform hardening — backend + mobile

## Phase 1 — Critical ✅

| Item | Implementation |
|------|----------------|
| Legacy `POST /common/extend-session-end-time` | Participant check + **403** `USE_PAID_EXTENSION` — use `/trainee/session-extension/*` |
| Scheduled `book-session` price | `computeScheduledDurationMinutes` + hourly rate validation in `bookSessionCore` |
| Trainer slot IDOR | `updateStot` / `deleteStot` require `trainer_id` match |
| Report / PDF ownership | `assertTrainerOwnsSession` on create, addImage, addSessionRecording, `pdfUploadUrl` |
| Instant REST | `POST /trainer/instant-lesson/accept` + `/decline` → `instantLessonActions.ts` |

## Phase 2 — High ✅ (mobile)

| Item | Implementation |
|------|----------------|
| Rejoin slot check | `MeetingRouter` error UI + retry |
| Precall fail-open | Slot API error → blocked with message |
| Chats empty on error | `fetchConversations` throws; error banner + retry |
| Mixed client warning | `sessionJoinReadinessService` + precall banner |

## Phase 3 — Medium ✅

| Item | Implementation |
|------|----------------|
| Chat rate limit | `chatSendLimiter` on `/common/chat-send` |
| `book-session` role | `traineeMiddleware.isTrainee` |
| Dead booking modal | Removed from mobile (unused) |

## Web repo (not in this pass)

- Migrate `updateExtendedSessionTime` to paid extension APIs
- Adopt `session-join-readiness` in portrait-calling
- Post-call handoff / recap parity
