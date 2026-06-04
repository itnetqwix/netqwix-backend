# QA matrix — points, referrals, promos

Use this checklist after deploy or when changing earn/redeem/checkout rules.

## Points eligibility

| # | Scenario | Expected |
|---|----------|----------|
| P1 | Active trainee earns lesson points on completed session | +3 lesson, +1 booking (within weekly caps) |
| P2 | Active trainer earns lesson + game plan points | +3 lesson; +5 game plan once per session id |
| P3 | Hibernated user completes session | No new points |
| P4 | Pending-deletion user redeems | 400 — cannot redeem |
| P5 | `WALLET_ENABLED=false` redeem | 400 before balance debit |
| P6 | Redeem 100 pts with balance 150 | Wallet +$5; balance 50 |

## Points clawback (cancel / refund)

| # | Scenario | Expected |
|---|----------|----------|
| C1 | Completed session → cancelled/refunded | Lesson/booking/review points clawed back if previously awarded |
| C2 | Cancel before complete | No lesson points to claw back; promo usage reverted if code applied |
| C3 | First-booking referral on cancelled completed session | Referrer points clawed back; `first_booking_reward_settled` reset |

## Referrals

| # | Scenario | Expected |
|---|----------|----------|
| R1 | Trainer → trainee signup | Referrer + referee signup points (≤5 each) |
| R2 | Trainee referred, first completed lesson as **trainee** | Referrer first-booking points |
| R3 | Trainee referred, first completion only as **trainer** on a booking | No first-booking reward (role mismatch) |
| R4 | Self-referral code | No attribution |
| R5 | Checkout with promo | Promo $ off only; **no** referral checkout $ |
| R6 | Legacy wallet referral credits | Unchanged on balance |

## Promos

| # | Scenario | Expected |
|---|----------|----------|
| M1 | Platform code on any coach | Valid |
| M2 | Coach code on different coach | Rejected |
| M3 | Per-user limit 1, book + cancel + rebook | Second use allowed after cancel (usage reverted) |
| M4 | Expired / max global uses | Rejected |
| M5 | Platform 100% off | Trainee $0; trainer net per quote (list price) |
| M6 | Coach 100% off | Trainee $0; trainer net $0 |

## Admin

| # | Scenario | Expected |
|---|----------|----------|
| A1 | `/apps/referrals` dashboard | Points issued, redemptions, matrix chips |
| A2 | `/apps/promo-codes` | Platform + coach tabs, stats |

## Clients

| Surface | Referrals/points | Promos |
|---------|------------------|--------|
| Mobile | Invite, wallet, points activity | Checkout + coach Settings |
| Web | Invite card shows points copy | Existing validate-promo on schedule |
| Admin | Referrals + promo-codes pages | See A1–A2 |
