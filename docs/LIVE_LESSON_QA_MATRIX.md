# Live lesson QA matrix (instant + scheduled)

Authoritative manual + automation map for **mobile** (`nq-mobile`) and **API** (`nq-backend-main`).  
Cross-ref: [QA_10_PILLAR_MATRIX.md](./QA_10_PILLAR_MATRIX.md) pillars **P1–P10**.

**Legend:** `I` = instant, `S` = scheduled, `M` = mobile, `A` = API, `—` = N/A for that type.

| ID | Area | Scenario | Expected | I | S | Owner (mobile) | Owner (API) |
|----|------|----------|----------|---|---|----------------|-------------|
| **B1** | Booking | Instant eligibility when coach offline | 4xx / UI block | ✓ | — | `fetchInstantLessonEligibility` | `instantEligibilityService` |
| **B2** | Booking | Instant book 15/30 min only | Booked `pending_accept` | ✓ | — | `useInstantLessonBookingWizard` | `bookInstantMeeting` |
| **B3** | Booking | Trainer accept within 2 min | `pending_join` + join deadline | ✓ | — | `InstantLessonContext` | `acceptInstantLessonAction` |
| **B4** | Booking | Trainer decline | Cancelled + refund | ✓ | — | `InstantLessonContext` | `declineInstantLessonAction` |
| **B5** | Booking | Accept window expire | Expire + refund | ✓ | — | `SessionLifecycleBridge` | `runInstantLessonExpire` |
| **B6** | Booking | Scheduled check-slot + timezone | Slot free / taken | — | ✓ | `scheduledBookingApi` | `checkSlotExist` |
| **B7** | Booking | Scheduled book-session | Confirmed/booked row | — | ✓ | `ScheduledBookingWizard` | `bookSessionCore` |
| **B8** | Booking | Trainer scheduled popup (not instant) | `SessionActionModal` | — | ✓ | `SessionBookingContext` | `getScheduledMeetings` |
| **B9** | Booking | Wallet idempotency double-tap | Single charge | ✓ | ✓ | payment steps | P5-2 |
| **P1** | Pre-call | Join-readiness trainer/trainee | 200 + peer + clips | ✓ | ✓ | `sessionLiveApi` | `sessionJoinReadinessService` |
| **P2** | Pre-call | Call-slot claim / takeover | Block or reclaim | ✓ | ✓ | `MeetingRouter` | `lessonCallSlotStore` |
| **P3** | Pre-call | Rejoin after background | Slot + timer sync | ✓ | ✓ | `useCallForegroundRecovery` | P3 |
| **P4** | Pre-call | 15 min early join (scheduled) | Join enabled | — | ✓ | `canJoinSession` | — |
| **C1** | In-call | Timer auto-start (instant trainer) | Starts when both joined | ✓ | — | `useLessonTimer` | socket timer |
| **C2** | In-call | Timer manual start (scheduled) | Trainer taps Start | — | ✓ | `useLessonTimer` | socket timer |
| **C3** | In-call | Clips sync trainer→trainee | Same selection | ✓ | ✓ | `useClipSync` | socket |
| **C4** | In-call | Drawing burn-in screenshot | Annotations on JPEG | ✓ | ✓ | `AnnotationBurnInHost` | — |
| **C5** | In-call | Live WebRTC screenshot | Non-blank when video live | ✓ | ✓ | `LiveVideoCaptureHost` | — |
| **C6** | In-call | Screenshot offline queue | Retry on online | ✓ | ✓ | `screenshotUploadQueue` | `/report/add-image` |
| **C7** | In-call | Crop pre-upload | New presign upload | ✓ | ✓ | `replacePendingUpload` | `/report/crop-image` |
| **C8** | In-call | Extension request + pay | Timer extends | ✓ | ✓ | `useSessionExtensionFlow` | `sessionExtensionService` |
| **C9** | In-call | Socket reconnect mid-call | Media resumes | ✓ | ✓ | `CallContext` | P1 |
| **R1** | Post-call | Recap → game plan | Modal flow | ✓ | ✓ | `SessionRecapSheet` | `/report/create` |
| **R2** | Post-call | Game plan PDF + locker | PDF on session | ✓ | ✓ | `SessionGamePlanModal` | `pdfUploadUrl` |
| **R3** | Post-call | Ratings + handoff | Rebook CTA | ✓ | ✓ | `SessionHandoffScreen` | `session-handoff` |
| **R4** | Post-call | Locker edit plan | Save changes | ✓ | ✓ | `GamePlansScreen` | `/report/create` |
| **CH1** | Chat | Game plan send to chat | DM message | ✓ | ✓ | `SessionGamePlanModal` | chat API |
| **CH2** | Chat | Offline send queue | Flush on online | ✓ | ✓ | chat feature | P7 |

## Automation mapping

| Suite | Matrix IDs |
|-------|------------|
| `src/config/__tests__/instantLesson.test.ts` | B2 (durations) |
| `src/helpers/__tests__/sessionAccess.test.ts` | B7 (duration math) |
| `src/modules/instant-lesson/__tests__/instantLessonActions.test.ts` | B3, B4 |
| `src/modules/session/__tests__/sessionJoinReadinessService.test.ts` | P1 |
| `src/Utils/__tests__/bookingConflict.test.ts` | B6, B7 |
| `src/modules/trainee/__tests__/sessionExtensionValidator.test.ts` | C8 |
| `src/helpers/robustness/__tests__/callQualityPayload.test.ts` | P8 |
| `src/helpers/__tests__/liveLessonRules.test.ts` | P4 (join windows) |
| `scripts/live-lesson-smoke.mjs` | deploy smoke |

See also [LIVE_LESSON_BACKEND.md](./LIVE_LESSON_BACKEND.md) for API contracts.
| `nq-mobile` `sessionUtils.test.ts` | P4, B8 (instant detect) |
| `nq-mobile` `reportDataUtils.test.ts` | R2 |
| `nq-mobile` `screenshotUploadQueue.test.ts` | C6 |
| `nq-mobile/e2e/maestro/*.yaml` | B7→R2, B2→C1 |

## Open gaps (fill on staging run)

| ID | Status | Notes |
|----|--------|-------|
| — | Pending QA | Run full matrix on staging; file GitHub issues per failure |

## Sign-off

| Build | Tester | Date | Instant | Scheduled |
|-------|--------|------|---------|-----------|
| API @ | | | | |
| Mobile iOS @ | | | | |
