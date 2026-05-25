# NetQwix Backend (`netquix-api`) — Project Documentation

> Single source of truth for **what is in the backend, how it works, and the cases it handles**.
> Update this file every time a new module/route/feature is added.

---

## 1. Project Overview

**Type:** Node.js + TypeScript REST + WebSocket API for the NetQwix platform.

**Runtime:** Node `>=20 <23`, npm `>=10`, runs as a single Express HTTP server with Socket.IO and PeerJS attached on the same port.

**Persistence:**
- **MongoDB** via Mongoose (primary data store).
- **Redis** (optional but required for multi-process / multi-server) — used for Socket.IO adapter, distributed locks, pub/sub, idempotency, rate limits, BullMQ queues.
- **AWS S3** for media (clips, recordings, profile photos, chat media, PDFs).

**External integrations:**
- **Stripe** — payments, refunds, payouts, KYC (Connect), webhooks.
- **Twilio** — SMS + WhatsApp.
- **Nodemailer / SES** — transactional + promotional email.
- **OpenAI** — AI service (recommendations, lesson summaries, smart re-engagement copy, clip tagging, smart search).
- **AWS Rekognition** — face/liveness verification.
- **web-push** — browser push notifications.
- **Expo Push** — mobile push (via push token registry).
- **Sentry** — error/telemetry.
- **PeerJS** — WebRTC signaling (mounted at `/peerjs`).

**Process manager:** PM2 (`ecosystem.config.js`). Use `PM2_INSTANCES=1` unless you have sticky sessions configured (Socket.IO polling otherwise fails with “Session ID unknown” across workers).

---

## 2. Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Boot — loads env, init Sentry, asserts JWT secret, instantiates `App`. |
| `src/app.ts` | Express app + HTTP server. Mounts middleware, CORS, routes, Socket.IO, PeerJS, Redis bootstrap, cron jobs (leader only). |
| `routes.ts` (project root) | Top-level router — mounts every feature module under `/` (see Routes table). |
| `src/bootstrap/redisBootstrap.ts` | Wires Redis client, pub/sub, Socket.IO adapter. |
| `src/bootstrap/sentry.ts` | Initializes `@sentry/node`. |
| `src/bootstrap/jobWorkersBootstrap.ts` | BullMQ workers (booking reminders, instant lesson deadlines, extension timers). |

**Health endpoint:** `GET /health` — returns Redis, Socket.IO adapter, pub/sub mode, optional messaging health, uptime.
**Connected users (admin only):** `GET /connected-users`.
**PeerJS signaling:** `GET /peerjs/*`.
**Webhooks (no auth):** `POST /webhooks/*` (Stripe).

---

## 3. Top-Level Routes (from `routes.ts`)

| Mount | Module | Notes |
|-------|--------|-------|
| `/user` | `src/modules/user` | Profile, friends, bookings, KYC, reports, notifications settings. |
| `/auth` | `src/modules/auth` | Signup/Login/OTP, magic link, Google/Apple SSO, refresh, sessions, rate-limited. |
| `/master` | `src/modules/master` | Static master data (categories, etc.). |
| `/trainer` | `src/modules/trainer` | Slot CRUD, availability, trainee notes, nudges, session recap, money withdraw, paid extension respond. |
| `/trainee` | `src/modules/trainee` | Book session (idempotent), book instant lesson, favorites, personalized feed, guest activity, paid extension request/confirm. |
| `/transaction` | `src/modules/transaction` | Stripe payment intents + refunds. |
| `/common` | `src/modules/common` | Uploads, chat (legacy compat), clips lookup, promo validation. |
| `/report` | `src/modules/report` | Trainer post-session reports (images, recordings, crop). |
| `/admin` | `src/modules/admin` | Commission, call diagnostics, User 360, audit log, dashboard metrics, finance ops, ops events, trainer verifications, clip-library admin, messaging health. |
| `/notifications` | `src/modules/notifications` | In-app + push subscriptions, preferences, mute / quiet hours. |
| `/chat` | `src/modules/chat` | Conversations, messages, send. |
| `/admin/promo-codes` | `src/modules/promo-code` | Promo CRUD + visibility/toggle. |
| `/admin/broadcasts` | `src/modules/broadcast` | Targeted broadcast compose + history. |
| `/ai` | `src/modules/ai` | OpenAI-powered features (recommendations, lesson summary, profile enhance, smart schedule, review analysis, smart search). |
| `/wallet` | `src/modules/wallet` | Balance, ledger, earnings, top-up (idempotent), withdraw (idempotent), PIN, payout preference. |
| `/storage` | `src/modules/storage` | Canonical presigned PUT + confirm for clip uploads (locker / instant lesson). |
| `/ops` | `src/modules/ops` | Client-side ops event ingest (call quality, errors). |
| `/verification` | `src/modules/verification` | Identity status, OTP (mobile), face/liveness session via Rekognition. |
| `/clips` | `src/modules/clips` | Public taxonomy, library submissions, account reapply. Admin clip routes mounted under `/admin`. |
| `GET /` | inline | Health string. |

---

## 4. Feature Modules — Detailed

### 4.1 Auth (`src/modules/auth`)

**Files:** `authController`, `authService`, `authSessionService`, `magicLinkService`, `signupOtpService`, `loginLockoutService`, `refreshTokenService`, `passwordPolicy`, `authMiddleware`, `appleTokenVerify`, `clientSessionMeta`, validators (`signup`, `login`, `googleSignIn`, `appleSignIn`).

**Endpoints:**
- Signup flow: `POST /auth/signup/check-contact`, `/signup/otp/send`, `/signup/otp/verify`, `/signup`.
- Login: `POST /auth/login` (rate-limited via `authLoginLimiter`).
- Magic Link: `POST /auth/magic-link/request`, `/magic-link/verify`.
- Refresh: `POST /auth/refresh`.
- Logout: `POST /auth/logout`.
- SSO: `POST /auth/verify-google-login`, `/auth/verify-apple-login`.
- Multi-session management: `POST /auth/sessions/register`, `GET /auth/sessions`, `POST /auth/sessions/revoke` / `revoke-others` / `revoke-all`.
- Forgot password: `POST /auth/forgot-password`, `PUT /auth/confirm-reset-password`.

**Cases handled:**
- Brute-force login lockout (`loginLockoutService`).
- Magic-link short-lived tokens (`magic_link_token.schema.ts`).
- Signup OTP via email/SMS with `signup_verification_otps.schema.ts`.
- Refresh-token rotation + session registry (`auth_session.schema.ts`).
- Admin bootstrap signup gated by `ADMIN_PUBLIC_SIGNUP_ENABLED`.

### 4.2 User (`src/modules/user`)

Profile, friends, blocking, reporting, ratings, KYC, online availability, account deletion.

**Cases handled:**
- `POST /user/sign-up` — public signup bypass (legacy).
- `GET /user/me` — bearer-auth restore session.
- KYC flow: `register-user-with-stripe`, `update-kyc-status`, `create-verification-session`, `stripe-account-verification`, `check-stripe-verification`.
- Bookings: `booking-list`, `booking-list-by-id`, `booking/:bookingId`, `session-detail/:bookingId`.
- Trainer admin: `update-trainer-commission`, `update-trainer-status`, `approve-expert/:id`.
- Trainer online toggles: `online-availability`, `auto-decline-outside-hours`, `update-trainer-status`.
- Storage plans: `GET /user/storage`, `POST /user/storage/checkout`.
- Chat E2E key registry: `PUT /user/me/chat-public-key`, `GET /user/:id/chat-public-key` (Curve25519).
- Friends graph: send/accept/reject/cancel/remove + block + report + privacy toggle.
- Content sharing: `share-clips`, `invite-friend`, `my-referrals`.
- Support: `write-us`, `raise-concern`, status updates, listing.
- Self-delete: `DELETE /user/me`.

### 4.3 Trainer (`src/modules/trainer`)

- Public listing: `GET /trainer/top-trainers`.
- Scheduling slots CRUD: `update-slots`, `add-slot`, `update-slot`, `delete-slot`, `get-slots`.
- Availability lookup: `POST /trainer/get-availability`.
- Profile update: `PUT /trainer/profile`.
- Withdrawals (money request): `create-money-request`, `get-money-request`.
- Paid extension respond: `POST /trainer/session-extension/respond` (validator `sessionExtensionRespondModal`).
- Trainee notes CRUD: `GET/PUT/DELETE /trainer/trainee-notes/:traineeId`.
- Engagement: `GET /trainer/nudge-candidates`, `POST /trainer/trainee-nudge`.
- Session recap: `POST /trainer/session-recap`.

### 4.4 Trainee (`src/modules/trainee`)

- Browse trainers: `GET /trainee/get-trainers-with-slots`, `recent-trainers`.
- Booking (idempotent): `POST /trainee/book-session` — uses `Idempotency-Key` header + `bookSessionModal`.
- Instant lesson (idempotent): `POST /trainee/book-instant-meeting` + `GET /trainee/instant-lesson/eligibility`.
- Profile + slot check: `PUT /trainee/profile`, `POST /trainee/check-slot`.
- Favorites: `GET/POST/DELETE /trainee/favorite-trainers[/:trainerId]`.
- Guest funnel: `POST /trainee/guest-activity`, `GET /trainee/guest-activity/seeded-trainers`.
- Personalized feed: `GET /trainee/personalized-feed`.
- Paid session extension (mid-call):
  - Quote: `GET /trainee/session-extension/quote`.
  - Request (idempotent): `POST /trainee/session-extension/request`.
  - Cancel request: `POST /trainee/session-extension/cancel-request`.
  - Payment intent: `POST /trainee/session-extension/create-payment-intent`.
  - Confirm (idempotent): `POST /trainee/session-extension/confirm`.

### 4.5 Wallet & Finance (`src/modules/wallet`)

Modular financial subsystem with double-entry ledger, escrow, payouts, audit log, refunds, and Stripe integration.

**Sub-services:**
- `ledgerService.ts` — append-only `wallet_ledger_entries`.
- `escrowService.ts` — booking holds (`escrow_holds`).
- `releaseService.ts` — releases eligible holds (cron every 15 min).
- `payoutService.ts` — payout queue with two-admin approval.
- `walletAccountService.ts` — `wallet_accounts`.
- `topUpService.ts` — Stripe top-ups (`wallet_topups`).
- `migrationService.ts` — legacy trainer balance migration.
- `walletPaymentService.ts`, `refundTransferService.ts`, `instantLessonRefundService.ts`.
- `financialAuditService.ts` — immutable audit log.
- `stripeWebhookService.ts` — handles `payment_intent.*`, `charge.refunded`, transfer/payout events.
- `pinService.ts` — wallet PIN (set/verify/forgot — rate-limited via `walletPinLimiter`).

**Endpoints (`/wallet` — user):**
- `GET /wallet/config` (public).
- `GET /wallet/balance`, `/transactions/:id`, `/ledger`, `/earnings`, `/trainer-pulse`, `/trainer-earnings-series`, `/trainer-earnings.csv`.
- Top-up: `POST /wallet/topup/create-intent` (idempotent), `GET /wallet/topup/:topupId/status`, `POST /wallet/topup/:topupId/confirm` (idempotent).
- PIN: `POST /wallet/pin/set`, `/pin/verify`, `/pin/forgot/request`, `/pin/forgot/confirm`.
- Payout: `PUT /wallet/payout-preference`, `POST /wallet/withdraw` (idempotent).

**Admin finance (`/admin/finance/*`):** ledger, escrow listing/release/refund, payout queue + approve, wallet adjust, audit log, legacy balance migration.

**Webhooks:** `/webhooks/*` (mounted outside the global auth pipeline) — Stripe events.

### 4.6 Chat (`src/modules/chat`)

**Files:** `chatController`, `chatService`, `chatExtrasService`, `chatPolicy`, `chatSendValidator`.

Server-side ratelimit `chatSendLimiter` on `/chat/send`.

**Endpoints under `/chat`:** `GET /conversations`, `GET /messages/:conversationId`, `POST /send`, `POST /conversation` (get-or-create).

**Extended chat endpoints under `/common` (legacy compat path used by web + mobile):**
- Groups: create, create-with-invites, members, invite, remove-member, exit, delete, update, invites, invite-respond.
- Messaging: edit, delete, react, forward, pin/unpin, pinned, transcribe (voice), schedule + list + cancel scheduled, search.
- Conversation lifecycle: archive, unarchive, delete, clear, disappearing (TTL), read-receipts toggle.
- Admin moderation: `/common/chat-flagged`, `/common/chat-flag-update` (admin only).

**Real-time events** (`EVENTS.CHAT` in `src/config/constance.ts`):
`CHAT_MESSAGE`, `JOIN_CHAT`, `LEAVE_CHAT`, `CHAT_DELIVERED`, `CHAT_READ`, `CHAT_TYPING`, `CHAT_STOP_TYPING`, `CHAT_MESSAGE_EDITED`, `CHAT_MESSAGE_DELETED`, `CHAT_REACTION_UPDATED`, `CHAT_PINNED`, `CHAT_CONVERSATION_UPDATED`, `CHAT_TRANSCRIPT_READY`.

**Models:** `chat_conversation.schema.ts`, `chat_message.schema.ts`, `chat_flag.schema.ts`, `scheduled_chat_message.schema.ts`.

**E2E:** Per-user Curve25519 public key (NaCl box) stored on user; clients encrypt with peer’s key. Public-key registry endpoints in user module.

### 4.7 Notifications (`src/modules/notifications`)

- In-app + browser + mobile push.
- `GET /` list, `GET /get-public-key` (VAPID), `POST /subscription`, `PATCH /update`.
- Push tokens: `POST /register-push-token`, `DELETE /unregister-push-token/:deviceId` (`push_token.schema.ts`).
- Preferences: `GET/PUT /preferences`, `POST /mute`, `POST /quiet-hours`.
- Types: `NotificationType.{DEFAULT, PROMOTIONAL, TRANSCATIONAL}` (`src/enum/notification.enum.ts`).

### 4.8 Clips (`src/modules/clips`)

**User routes (`/clips`):**
- `GET /clips/taxonomy` (categories + subcategories).
- `POST /clips/library-submissions` (submit clip for the public library).
- `GET /clips/library-submissions/mine`.
- `POST /clips/account/reapply` (after trainee rejection).

**Admin routes (mounted under `/admin`):**
- Category CRUD: `/clip-categories`, `/clip-subcategories`.
- Library clips: `/library/clips/presign`, `/library/clips/confirm`, `/library/clips`, `DELETE /library/clips/:clipId`.
- Submissions: `GET /library-submissions`, `POST /library-submissions/:id/{under-review,approve,reject}`.
- Trainee account moderation: `POST /trainee-accounts/:userId/{approve,reject}`.

**Models:** `clip.schema.ts`, `clip_category.schema.ts`, `clip_subcategory.schema.ts`, `clip_library_submission.schema.ts`.

### 4.9 Storage (`src/modules/storage`)

Canonical presigned S3 PUT path for the locker + instant lesson clips.
- `POST /storage/clips/presign` (`clipPresignService`).
- `POST /storage/clips/confirm` (`clipConfirmService`).

(Legacy upload helpers still exist in `/common`.)

### 4.10 Promo Codes & Broadcasts

**Promo (`/admin/promo-codes`):** CRUD + `PATCH /:id/toggle` (enable) + `PATCH /:id/visibility`. Also exposed for users via `/common/validate-promo` and `/common/visible-promos`.

**Broadcasts (`/admin/broadcasts`):** create, list, preview audience count, getById, resend, delete. Channels & utilities in `BroadcastController` (email, SMS, push, in-app).

### 4.11 AI (`src/modules/ai`)

OpenAI-powered. All authenticated.
- `GET /ai/recommend-trainers` — semantic match.
- `POST /ai/chat-assistant` — RAG-ish helper.
- `GET /ai/lesson-summary/:sessionId`.
- `POST /ai/tag-clip/:clipId`.
- `GET /ai/enhance-profile` + `POST /ai/apply-enhanced-profile`.
- `GET /ai/smart-schedule/:trainerId`.
- `GET /ai/review-analysis`.
- `GET /ai/smart-search`.

`AIService` is also used by the daily cron `smartReEngagementJob` for re-engagement copy.

### 4.12 Verification (`src/modules/verification`)

- `GET /verification/status` — current onboarding gate.
- OTP: `POST /verification/otp/send`, `/otp/verify`.
- Profile update: `PUT /verification/profile`.
- Face/liveness: `POST /verification/face/session`, `/face/complete` (`rekognitionLivenessService`).
- Admin review under `/admin/trainer-verifications/*` — list, pending-count, migrate, detail, approve, reject (with SLA escalation cron).

**Models:** `verification_otps.schema.ts`, `signup_verification_otps.schema.ts`, `trainer_verification_audit.schema.ts`.

### 4.13 Ops Events (`src/modules/ops`)

- Client ingest: `POST /ops/events/report` (authed).
- Admin: list/stats/playbook/backfill/listByUser/listBySession/detail/resolve.
- Loggers: `opsCallLogger`, `opsInstantLogger`.
- Playbook + backfill service handles recovery of missed events.
- Model: `ops_events.schema.ts`.

### 4.14 Admin (`src/modules/admin`)

Aggregator of admin-only endpoints (auth-required).
- Commission: `update-global-commission`, `get-global-commission`.
- Call analytics: `call-diagnostics`, `call-quality-summary/:sessionId`.
- User 360 + timeline + lessons + reviews + assets + entity delete.
- Audit log: `GET /admin/audit-logs` (`admin_audit.schema.ts`).
- Dashboard: `GET /admin/dashboard-metrics`, `GET /admin/online-users`.
- Booking detail: `GET /admin/booking/:bookingId`.
- Messaging health: `GET /admin/messaging-health`.
- Finance + ops + trainer-verifications + clip-library all mounted under `/admin/*`.

**Permissions:** `adminPermission.assertAdminUser` guards admin-only chat moderation + connected-users endpoint.

### 4.15 Master, Common, Transaction, Report

- **Master (`/master`)** — `GET /master/master-data` (categories, etc.).
- **Common (`/common`)** — see Chat extras above; also `extend-session-end-time`, `upload` (multer disk), `video-upload-url`, `saved-sessions-upload-url`, `get-all-saved-sessions`, `pdf-upload-url`, `get-clips`, `get-shared-clips`, `get-library-clips`, `trainee-clips`, `delete-clip/:id`, `delete-saved-session/:id`, `update-profile-picture`, `generate-thumbnail` (ffmpeg), `featured-content-upload-url`, `chat-media-upload-url`.
- **Transaction (`/transaction`)** — Stripe payment intent create/get + refund-by-intent-id.
- **Report (`/report`)** — trainer post-session reports with images and recordings (`createReport`, `add-image`, `add-session-recording`, `remove-image`, `crop-image`, `get`, `get-all`, `delete-report/:id`).

---

## 5. Real-time (Socket.IO)

**Init:** `src/modules/socket/init.ts` (auth middleware → connect → presence registration → event dispatcher → disconnect handler).

**Authentication:** `extractSocketToken` (auth header or query) → `AuthMiddleware.loadSocketUser` → attaches lean `user` to socket.

**Presence:**
- Per-user room: `user:<userId>`.
- Admin presence room: `admin-presence` (admins receive `ADMIN_ONLINE_USERS` and `ADMIN_DASHBOARD_METRICS` every 30s).
- `MemCache` keeps `userId → socketId`.

**Event categories (from `EVENTS` in `src/config/constance.ts`):**
- **Lifecycle:** `ON_CONNECT`, `ON_DISCONNECT`, `ON_ERROR`, `JOIN_ROOM`.
- **Whiteboard / video sync:** `DRAW`, `EMIT_DRAWING_CORDS`, `EMIT_STOP_DRAWING`, `MOUSE_*`, `EMIT_CLEAR_CANVAS`, `ON_CLEAR_CANVAS`, `EMIT_UNDO`, `ON_UNDO`, `ON_VIDEO_SELECT`, `CALL_END`, `ON_VIDEO_SHOW`, `TOGGLE_DRAWING_MODE`, `TOGGLE_FULL_SCREEN`, `TOGGLE_LOCK_MODE`, `ON_VIDEO_ZOOM_PAN`, `MEETING_TILE_LAYOUT`, `ON_VIDEO_PLAY_PAUSE`, `ON_VIDEO_TIME`.
- **Video call (WebRTC signaling):** `offer`, `answer`, `ice-candidate`, `signal`, `stream`, `connect`, `close`, `MUTE_ME`, `STOP_FEED`, `ON_CALL_JOIN`, `ON_BOTH_JOIN`, `ON_CALL_LEAVE`.
- **Push:** `PUSH_NOTIFICATIONS.{ON_SEND, ON_RECEIVE}`.
- **Bookings:** `BOOKING_CREATED`, `BOOKING_STATUS_UPDATED`.
- **Instant lesson:** `INSTANT_LESSON_REQUEST`, `_ACCEPT`, `_DECLINE`, `_EXPIRE`, `_PHASE`, `_CLIPS_SELECTED`, `_TRAINEE_CANCELLED`, `_SESSION_RECORDING`.
- **Chat:** see §4.6.
- **Lesson timer:** `LESSON_TIME_WARNING`, `LESSON_TIME_ENDED`, `TIMER_STARTED`, `LESSON_TIMER_EXTENDED`, `LESSON_TIME_PAUSED`, `LESSON_TIME_RESUMED`.
- **Session extension:** `SESSION_EXTENSION_{REQUESTED, ACCEPTED, REJECTED, CANCELLED, EXPIRED, PAYMENT_STARTED, APPLIED}`.

**Cross-instance fan-out:** `@socket.io/redis-adapter` (attached during `bootstrapRedis`). Lesson timer state stored in `lessonTimerStore` (Redis-backed when available).

**Helpers:** `socketEmit.ts`, `socketEventBridge.ts`, `socketRedisAdapter.ts`, `socketAdapterState.ts`, `socketPresenceRegistry.ts`.

---

## 6. Middleware (`src/middleware`)

| Middleware | Purpose |
|------------|---------|
| `authorize.middleware.ts` | Decodes JWT, attaches `req.authUser`. Bypass paths can be set via `req.byPassRoute` before the call. |
| `isValidToken.middleware.ts` | Validates `:id` mongo params. |
| `rateLimit.middleware.ts` | `globalApiLimiter`, `authLoginLimiter`, `authForgotLimiter`, `authSignupOtpLimiter`, `walletPinLimiter`, `chatSendLimiter`. Redis-backed when available. |
| `securityHeaders.middleware.ts` | Helmet-style headers. |
| `idempotency.middleware.ts` | `requireIdempotencyKey` + `idempotentHandler` — wraps booking, instant lesson, top-up, withdraw, session extension confirm. Uses `idempotencyService`. |
| `requestContext.middleware.ts` | Attaches request id + structured logging context. |
| `trim.middleware.ts` | Trims body strings. |
| `trainerOnboarding.middleware.ts` | Enforces trainer profile + verification gates. |

---

## 7. Cron Jobs (`src/cronjob`)

Started only on the cluster **leader** (`isClusterLeader()`).

| Schedule | Job | Source |
|----------|-----|--------|
| `* * * * *` | Booking meeting-confirmation emails + push reminders + cleanup inactive `online_user`. | `cronjob/index.ts:meetingConfirmationJob` (skipped if BullMQ booking reminders enabled). |
| `0 10 * * *` | Smart re-engagement (inactive 7–30 day trainees, AI copy + push + notification row). | `cronjob/index.ts:smartReEngagementJob`. |
| `*/15 * * * *` | Escrow release for eligible holds. | `releaseService.processEligibleHolds`. |
| `0 * * * *` | Trainer verification SLA escalation. | `trainerReviewService.processSlaEscalations`. |
| `*/5 * * * *` | Instant-lesson refunds for failed/no-show. | `instantLessonRefundService.processPendingInstantRefunds`. |
| `*/5 * * * *` | Scheduled session no-show refunds. | `cronjob/scheduledNoShowJob.ts`. |
| `* * * * *` | Instant lesson recovery (expired pending). | `cronjob/instantLessonRecoveryJob.ts`. |
| `* * * * *` | Booking reminders (legacy fallback). | `cronjob/bookingRemindersJob.ts`. |
| `* * * * *` | Scheduled chat dispatch (`scheduled_chat_message`). | `ChatExtrasService.dispatchDueScheduledMessages`. |
| `*/10 * * * *` | Refund transfer reconciliation (Stripe ↔ local). | `refundTransferService.reconcileProcessingRefundTransfers`. |

**Queues (BullMQ):** `bookingReminderQueue`, `instantLessonDeadlineQueue`, `extensionTimerQueue`, `delayedJob`. Toggle via `BULLMQ_BOOKING_REMINDERS`.

---

## 8. Data Models (`src/model/*.schema.ts`)

| Schema | Purpose |
|--------|---------|
| `user.schema.ts` | Core user (trainer / trainee / admin) — auth fields, profile, friends, blocking, notifications prefs, KYC, chat key, `auto_decline_outside_business_hours`, `showAsOnline`, privacy. |
| `auth_session.schema.ts` | Multi-device sessions with refresh-token rotation. |
| `magic_link_token.schema.ts` | Magic-link tokens. |
| `signup_verification_otps.schema.ts`, `verification_otps.schema.ts` | OTP for signup/mobile/email verification. |
| `availability.schema.ts`, `schedule_inventory.schema.ts` | Trainer slot grids. |
| `booked_sessions.schema.ts` | Scheduled + instant sessions (with refund metadata, extended end times, peer ice servers, recordings, ratings). |
| `booking_reminder_log.schema.ts` | Reminder idempotency. |
| `saved_sessions.schema.ts` | Recorded lessons stored in user locker. |
| `clip.schema.ts`, `clip_category.schema.ts`, `clip_subcategory.schema.ts`, `clip_library_submission.schema.ts` | Library + locker clips. |
| `chat_conversation.schema.ts`, `chat_message.schema.ts`, `chat_flag.schema.ts`, `scheduled_chat_message.schema.ts` | Chat. |
| `notifications.schema.ts`, `push_token.schema.ts` | Notifications. |
| `online_user.schema.ts`, `user_presence.schema.ts` | Presence. |
| `user_activity.schema.ts` | Activity log. |
| `trainee_guest_activity.schema.ts` | Guest engagement signals. |
| `trainee_favorite_trainers.schema.ts` | Favorites. |
| `trainer_trainee_note.schema.ts` | Trainer’s private trainee notes. |
| `report.schema.ts` | Post-session reports. |
| `raise_concern.schema.ts`, `write_us.schema.ts` | Support tickets. |
| `referred.user.schema.ts` | Referral graph. |
| `promo_code.schema.ts` | Promo codes. |
| `broadcast.schema.ts` | Admin broadcasts. |
| `master_data.ts` | Master data. |
| `wallet_accounts.schema.ts`, `wallet_ledger_entries.schema.ts`, `wallet_topups.schema.ts`, `wallet_security_events.schema.ts` | Wallet core. |
| `escrow_holds.schema.ts`, `payout_requests.schema.ts`, `financial_audit_log.schema.ts` | Finance. |
| `stripe_webhook_events.schema.ts` | Webhook idempotency. |
| `admin_audit.schema.ts` | Admin actions audit. |
| `call_diagnostics.schema.ts`, `ops_events.schema.ts` | Telemetry. |
| `trainer_verification_audit.schema.ts` | Verification audit. |
| `default_admin_setting.schema.ts` | Global settings. |

---

## 9. Services (`src/services`)

- `redisClient.ts` — connection + health.
- `distributedLock.ts` — Redlock-style.
- `cacheService.ts` — Redis cache.
- `idempotencyService.ts` — drives the idempotency middleware.
- `eventPubSub.ts` — `socketEventBridge` etc.
- `socketRedisAdapter.ts`, `socketAdapterState.ts` — Socket.IO adapter wiring.
- `bookingReminderScheduler.ts`, `extensionTimerQueue.ts` — BullMQ producers.
- `messagingHealth.ts` — email + SMS health diagnostics.
- `twilioRest.ts`, `sms-service.ts`, `whatsapp-service.ts` — Twilio.
- `ai-service.ts` — OpenAI gateway used by AI module + cron.

---

## 10. Configuration (`src/config`)

- `loadEnv.ts` — `.env` loader.
- `corsOrigins.ts` — origin allow-list (env-driven).
- `jwtSecret.ts` — startup assertion (process aborts without it).
- `redis.ts`, `pubsub.ts` — Redis + pub/sub topology.
- `processRole.ts` — PM2 cluster leader detection (`PM2_INSTANCES`).
- `ops.ts` — ops thresholds (call quality alerts).
- `instantLesson.ts`, `sessionExtension.ts`, `verification.ts` — feature-specific limits.
- `storage.ts`, `storageLimits.ts` — S3 + per-account quotas.
- `wallet.ts` — wallet flags.
- `tables.ts` — collection name registry.
- `constance.ts` — global constants + `EVENTS`.

---

## 11. Helpers (`src/helpers`)

- `responseBuilder.ts` — standard `ResponseBuilder` JSON shape (`status`, `code`, `message`, `result.data`).
- `error.ts` — `ClientError` and error formatter.
- `chatBlockCheck.ts` — enforce block list.
- `phoneNormalize.ts` — E.164 normalization.
- `instantLessonExpiry.ts` — derive expiry.
- `mongoose.ts` — query helpers.
- `socketAuth.ts` — token extraction.
- `stripe.ts` — Stripe client + helpers.
- `trainerCredentials.ts`, `trainerListingMatch.ts`, `trainerSlots.ts` — listing filters.
- `userActivity.ts` — activity logger.

---

## 12. Utilities (`src/Utils`)

- `database.ts` — Mongoose connect.
- `Utils.ts` — date/time helpers (`getCurrentHourAndMinute`, `formatDateTime`, `convertToAmPm`, etc.).
- `bcrypt.ts` — password hashing.
- `bookingConflict.ts` — slot overlap checks.
- `dateFormat.ts`, `constant.ts`, `jwt.ts`, `memCache.ts`, `s3Client.ts`, `sendEmail.ts`.

---

## 13. Templates & i18n

- `src/templates/` — Handlebars email templates (copied into `dist/` during build).
- `src/language/translation.en.json` — l10n strings (via `jm-ez-l10n`).

---

## 14. Environment Variables (key)

Always copy `sample.env`/`.env.example` to `.env`.

**Required:** `PORT`, `JWT_SECRET`, `MONGO_URI`, Stripe keys, AWS S3 keys (region/bucket), Twilio keys (if SMS), SMTP/SES creds, `OPENAI_API_KEY`, `SOCKET_CONFIG`.

**Optional but important:**
- `REDIS_ENABLED`, `REDIS_URL`, `REDIS_KEY_PREFIX`.
- `PM2_INSTANCES` (must stay `1` unless sticky sessions configured).
- `RUN_BACKGROUND_JOBS` (only leader runs cron + BullMQ workers).
- `BULLMQ_BOOKING_REMINDERS=true` to disable legacy cron reminders.
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`.
- `ADMIN_PUBLIC_SIGNUP_ENABLED`, `ADMIN_APP_URL`.
- `HEALTH_CHECK_MESSAGING=true` to include messaging probes in `/health`.

---

## 15. Operational Cases Handled

- **Multi-instance correctness:** Redis adapter + leader-only cron + Redis pub/sub for cross-worker event fan-out. App warns if `PM2_INSTANCES>1` without adapter or sticky LB.
- **Idempotent mutations:** `Idempotency-Key` header required on bookings, instant lessons, wallet top-ups, withdrawals, session extensions.
- **Token lifecycle:** JWT access + rotating refresh + multi-session registry + magic-link.
- **Brute force / abuse:** Per-route rate limiters + login lockout + wallet PIN limiter + chat send limiter.
- **Booking lifecycle:** schedule → confirm → start → complete | cancel → refund (with no-show + extension paths). Escrow holds released after configurable window.
- **Refund pipelines:** Stripe refunds + wallet returns + transfer reconciliation (cron).
- **Verification gate:** trainers can be in pending / approved / rejected / grace-period. SLA escalations cron.
- **Notifications fan-out:** email + push (web-push & Expo) + SMS + in-app. Quiet-hours and per-channel preferences enforced.
- **Chat moderation:** flag, admin review, block list, rate-limit, disappearing messages, read-receipt opt-out.
- **AI safeguards:** non-fatal — failures don’t block the request.
- **Webhooks:** mounted before global parsers (`/webhooks`), with idempotency via `stripe_webhook_events`.
- **Observability:** Sentry + structured logs (`lib/structuredLog.ts`) + `/health` + `/admin/messaging-health` + ops events + call diagnostics.
- **Graceful shutdown:** PM2 `kill_timeout: 8000`, `listen_timeout: 10000`.

---

## 16. Scripts

```bash
npm run dev     # ts-node-dev with respawn
npm run build   # tsc + copy email templates
npm run prod    # node dist/src/index.js
npm start       # tsc -w + nodemon
npm run lint    # tslint
npm run test:messaging  # node scripts/test-messaging.mjs
```

PM2: `pm2 start ecosystem.config.js --env production` / `pm2 reload … --update-env`.

Local Redis: `docker compose -f docker-compose.redis.yml up -d`.

---

## 17. How to Extend (Convention)

1. Add a folder under `src/modules/<feature>/` with `<feature>Controller.ts`, `<feature>Service.ts`, `<feature>Routes.ts`, optional `<feature>Validator(.ts|/)`, `<feature>Middleware.ts`.
2. Register the router in `routes.ts`.
3. If a new schema is needed, add it under `src/model/` with the suffix `.schema.ts` and register the collection in `src/config/tables.ts` if referenced elsewhere.
4. New mutating endpoints that need exactly-once semantics must use `requireIdempotencyKey` + `idempotentHandler`.
5. New socket events go into `EVENTS` in `src/config/constance.ts` and are dispatched via `socketEmit.ts` so they fan out across instances.
6. Add cron logic to `src/cronjob/index.ts` (or a sibling file) — only the leader instance runs cron.
7. Long-running jobs → BullMQ (`src/queues/`), with a worker registered in `src/bootstrap/jobWorkersBootstrap.ts`.
8. Add admin endpoints under `/admin/*` and guard with `assertAdminUser` if not already authorized.
9. Log significant admin actions to `admin_audit` schema.
10. Update this `PROJECT_DOCUMENTATION.md` — keep the routes table and feature description current.

---

## 18. Useful Cross-References

- Mobile client uses these routes — see `nq-mobile/src/api/apiContract.ts` and `nq-mobile/PROJECT_DOCUMENTATION.md`.
- Admin portal uses these routes — see `nq-admin-frontend/src/services/*Api.js` and `nq-admin-frontend/PROJECT_DOCUMENTATION.md`.
- API contract / OpenAPI export is generated from `nq-mobile/src/api/apiContract.ts` (`API_OPERATIONS`).
