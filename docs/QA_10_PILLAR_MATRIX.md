# NetQwix 10-Pillar Robustness — QA Matrix

Manual and automated coverage for call recovery, signaling, session FSM, payments, chat, observability, multi-device, and degradation.

**Platforms:** Mobile (`nq-mobile`) · Web (`nq-frontend-main`) · API (`nq-backend-main`)

**Automated (backend):** `npm test` — Jest unit tests under `src/**/__tests__/` and `src/helpers/robustness/__tests__/`.

---

## Pillar 1 — Call recovery on socket reconnect

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P1-1 | Mid-call socket drop | Join call → disable Wi‑Fi 10s → re-enable | `rejoinSignal` / `reconnectPeer`; partner video/audio resume; no duplicate Peer | ✓ | ✓ |
| P1-2 | Server restart during call | Call active → restart API → client reconnects | `ON_CALL_JOIN` or reconnect path restores session | ✓ | ✓ |
| P1-3 | `LESSON_STATE_REQUEST` after reconnect | Reconnect while in call | Timer/layout state matches server | ✓ | ✓ |
| P1-4 | Reconnect failed banner | Force invalid token / block socket | User sees reconnect-failed UX; can leave call cleanly | ✓ | Partial |

---

## Pillar 2 — Signaling (mute, chat join, layout/drawing replay)

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P2-1 | Remote mute badge | Partner mutes mic | Remote tile shows mic-off badge; unmute clears badge | ✓ | ✓ |
| P2-2 | `MUTE_ME` self-echo ignored | Mute self | Local UI only; remote badge unchanged | ✓ | ✓ |
| P2-3 | `STOP_FEED` camera off | Partner stops camera | Avatar/profile on remote tile | ✓ | ✓ |
| P2-4 | Chat `JOIN_CHAT` on reconnect | Open chat room → airplane mode → restore | Room re-joined; new messages appear | ✓ | ✓ |
| P2-5 | Drawing/layout replay (trainer) | Trainer draws → trainee reconnects | Strokes/layout restored | ✓ | Partial |

---

## Pillar 3 — AppState / background–foreground

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P3-1 | Background during call | Home button 30s → return | Call continues or recovers via foreground hook | ✓ | N/A |
| P3-2 | Incoming phone call | GSM interrupt → return | Mic/camera recover or user prompted | ✓ | N/A |
| P3-3 | Tab background (web) | Switch tab 2 min → return | Socket reconnect + lesson state sync | N/A | ✓ |

---

## Pillar 4 — Server session FSM + `LESSON_STATE_SYNC`

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P4-1 | Hydrate on `ON_CALL_JOIN` | Second device joins same session | Redis hydrate before fresh in-memory session | ✓ | ✓ |
| P4-2 | Timer starts when both joined | One user in room | Timer **not** started until both present | ✓ | ✓ |
| P4-3 | `LESSON_STATE_REQUEST` | Either party requests mid-call | Full sync payload (+ timer if running) | ✓ | ✓ |

---

## Pillar 5 — Payment idempotency + escrow

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P5-1 | Double tap wallet pay | Rapid double submit extension/booking | Single ledger + single escrow | ✓ | ✓ |
| P5-2 | Retry same `Idempotency-Key` | Repeat API with same header | Same result; no duplicate debit | ✓ | ✓ |
| P5-3 | Card PI webhook + client confirm | Stripe webhook + client both fire | One escrow record | ✓ | ✓ |

---

## Pillar 6 — Escrow reconciliation + refunds

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P6-1 | Refund Stripe failure | Force Stripe error on refund | Escrow **not** marked completed; retry possible | ✓ | ✓ |
| P6-2 | Reconcile cron | Stuck `held` escrow in DB | Cron moves or flags for ops | ✓ | ✓ |
| P6-3 | Instant lesson no-show | Accept but never join | Refund path per policy | ✓ | ✓ |

---

## Pillar 7 — Chat delivery, dedupe, retry

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P7-1 | Send while offline | Airplane mode → send text | Bubble stays; tap retry or auto flush on online | ✓ | ✓ (tap retry) |
| P7-2 | `clientMessageId` dedupe | Retry same client id | Server returns existing message; no duplicate row | ✓ | ✓ |
| P7-3 | Delivery + read ticks | A sends → B online in room | ✓ → ✓✓ → blue ✓✓ when receipts on | ✓ | ✓ |
| P7-4 | Read receipts disabled | B has receipts off | B unread clears; A sees delivered only | ✓ | ✓ |
| P7-5 | Media send failure | Bad network on image send | Failed state + retry | ✓ | Future |

---

## Pillar 8 — Observability

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P8-1 | `CALL_QUALITY_STATS` | Poor network on call | Server receives stats payload | ✓ | Partial |
| P8-2 | `CLIENT_CALL_ERROR` | Force Peer error | Structured error event | ✓ | Partial |
| P8-3 | `SOCKET_RECONNECT_FAILED` | Block socket permanently | Event + user-visible banner | ✓ | Partial |

---

## Pillar 9 — Multi-device / session revoke

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P9-1 | Login elsewhere | Device A logged in → login B revokes A | `AUTH_SESSION_REVOKED`; sign out | ✓ | ✓ |
| P9-2 | Revoke during active call | Revoke while in `NativeMeetingScreen` | Call ends then sign out | ✓ | N/A |
| P9-3 | Revoke during web call | Revoke during portrait call | Call teardown + redirect/login | N/A | ✓ |

---

## Pillar 10 — Graceful degradation

| ID | Scenario | Steps | Expected | Mobile | Web |
|----|----------|-------|----------|--------|-----|
| P10-1 | Degraded mode banner | High packet loss | Banner; reduced features if configured | ✓ | Partial |
| P10-2 | Network regain | Offline → online in call | Auto recovery attempt | ✓ | ✓ |
| P10-3 | Partner stale | Partner heartbeat lost | “Waiting to reconnect” message; no false end | ✓ | ✓ |

---

## Edge-case checklist (cross-pillar)

- [ ] Extension request while timer at 0:00 — only one active request; wallet idempotent
- [ ] Instant lesson: trainee cancels before trainer accepts — no escrow capture
- [ ] Group chat: delivery receipts use conversation room, not 1:1 receiver only
- [ ] Web chat: socket disconnect shows reconnect strip; send disabled only when no conversation
- [ ] Remote mute badge resets when switching session/partner (`toUser` change)
- [ ] Clip mode + one-on-one: mute badge on all remote `UserBox` / `UserBoxMini` instances

---

## Running automated tests

```bash
cd nq-backend-main
npm install   # ensures jest + ts-jest from devDependencies
npm test
```

Tests cover:

| Area | Test file |
|------|-----------|
| Instant accept/decline | `instantLessonActions.test.ts` |
| Join policy / early window | `liveLessonRules.test.ts` |
| Scheduled book guards (bookSessionCore) | `scheduledBookingValidation.test.ts`, `bookSessionCore.integration.test.ts` |
| Lesson client telemetry (Redis) | `lessonClientTelemetryStore.test.ts` |
| Refund escrow + pending cron | `instantLessonRefundService.test.ts` |
| Scheduled no-show refund job | `scheduledNoShowJob.test.ts` |
| Mixed client warning | `lessonClientTelemetry.test.ts` |
| Booking overlap | `bookingConflict.test.ts` |
| Call quality payload | `callQualityPayload.test.ts` |
| Chat dedupe / signaling | `chatDedupe.test.ts`, `signalingPayload.test.ts` |

---

## Sign-off template

| Build | Tester | Date | P1–P10 | Notes |
|-------|--------|------|--------|-------|
| mobile @ | | | | |
| web @ | | | | |
| api @ | | | | |
