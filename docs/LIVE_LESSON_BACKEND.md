# Live lesson backend contracts

Single place for server rules that mobile and web should rely on.

## Booking (stricter)

| Flow | Checks |
|------|--------|
| **Scheduled** `bookSession` | Valid HH:mm times; `start_time`/`end_time` in trainee TZ; slot not in past; **trainer + trainee** overlap via `checkBothPartiesBookingConflict`; price vs hourly rate; distributed lock per trainer slot |
| **Instant** `bookInstantMeeting` | `checkInstantLessonEligibility` (online, availability, overlap); duration 15/30 only; payment required; conflict returns **409** |

## Join readiness `GET /user/session-join-readiness/:bookingId`

Response includes:

| Field | Meaning |
|-------|---------|
| `join_policy` | `{ can_join, block_reason, join_code }` from `computeJoinPolicy` |
| `can_join` | Final gate after call-slot (second device) |
| `join_block_reason` | Human-readable message for lobby UI |
| `join_code` | Machine code — see `LIVE_LESSON_ERROR` in `liveLessonRules.ts` |
| `call_slot` | Device slot (`already_active_elsewhere`, takeover) |

Mobile should prefer `can_join` / `join_block_reason` from this endpoint over re-deriving all rules client-side.

## Instant REST

| Endpoint | Notes |
|----------|-------|
| Accept instant | **409** on trainer schedule conflict; **410** when accept window expired |
| Decline instant | **400** with `error` code |

## Reports

Trainer-only mutations use `assertTrainerOwnsSession` on create/add-image/crop/recording.

## Tests

```bash
npm test
# liveLessonRules, bookingConflict, sessionJoinReadiness, instantLessonActions
```

## Payments & refunds

| Path | Behaviour |
|------|-----------|
| Wallet book | `payFromWallet` → escrow hold; rollback on save failure |
| Card book | Stripe PI → webhook escrow; `quote_id` on book payload |
| Cancel / decline / expire | `refundSessionEscrow` (wallet ledger or Stripe PI refund) |
| Trainee cancel (pre-accept) | `POST /trainee/cancel-instant-lesson` or socket `TRAINEE_CANCELLED` |
| Trainer cancel session | `updateBookedSession` → `refundSessionEscrow` (not legacy Connect refund) |
| Cron | `processPendingInstantRefunds` — all cancelled sessions with `refund_reason` |

`refund_status`: `pending` → `processing` → `completed` | `failed` (see `src/config/paymentStatus.ts`).

Scheduled booking: invalid promo codes are rejected (same as instant).

`bookSession` route validation: `scheduledBookingValidation` (HH:mm, payment method, past slot) + class-validator on DTOs.

## Mixed client (native + web)

- Mobile sends `X-NQ-Client: mobile` on API + socket.
- `ON_CALL_JOIN` records participant client in `lessonClientTelemetryStore` (Redis key `nq:lesson:client:{sessionId}` when `REDIS_ENABLED=true`, else in-memory).
- `GET /user/session-join-readiness/:id` returns `mixed_client_warning` when peer is on web (or viewer is on web).
- Telemetry TTL: `REDIS_TTL.LESSON_CLIENT_TELEMETRY_SEC` (4h); cleared on lesson end via `sessionSummaryService`.

## Ops

- Redis/BullMQ required in production for instant accept/join timers and extension expiry.
- Smoke: `API_BASE=https://staging-api node scripts/live-lesson-smoke.mjs`
