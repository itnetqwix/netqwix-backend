# NetQwix points system

Platform-wide **points** replace direct referral wallet payouts. Users redeem points for wallet credit in fixed blocks.

## Economics

| Rule | Default |
|------|---------|
| Redemption | **100 points = $5** wallet credit (20 pts per $1) |
| Max per earn event | **5 points** |
| Typical earn values | 1, 3, or 5 per action |

## Earn actions (v1)

| Action | Role | Points | Cap |
|--------|------|--------|-----|
| Referral signup (referrer) | Both | up to 5 | once per attribution |
| Referral signup (referee) | Both | up to 3 | once |
| Referral first booking (referrer) | Both | up to 5 | once |
| Lesson completed (coach) | Trainer | 3 | 15/week |
| Lesson completed | Trainee | 3 | 15/week |
| Booking completed | Trainee | 1 | 7/week |
| Game plan saved | Trainer | 5 | 5/day |
| Review submitted | Trainee | 3 | 15/week |

Referral matrix values: `src/config/points.ts` (`referralMatrixPoints`).

## APIs

| Method | Path |
|--------|------|
| GET | `/points/catalog` |
| GET | `/points/balance` |
| GET | `/points/ledger` |
| POST | `/points/redeem` body `{ points: 100 }` |

## Referral

- No automatic **$** first-lesson checkout discount (disabled in `referral.ts`).
- Signup / first-booking rewards issue **points** via `referralService` → `pointsService.awardPoints`.
- `GET /referral/program` includes `rewardMatrixPoints`, `stats.pointsBalance`, `stats.totalEarnedPoints`.

## Persistence

- `user.points_balance`
- `points_ledger` — immutable earn/redeem rows with `idempotency_key`
- `points_redemption` — redeem audit when wallet credit is posted
- `referral_reward.points_awarded` (legacy `amount_minor` = 0 for new rows)

## Edge cases

- Idempotent keys per booking / attribution / report
- Redeem only in multiples of 100; insufficient balance → 400
- Weekly/daily caps per activity type
- **No earn/redeem** for hibernated, pending-deletion, or deleted accounts
- **Redeem blocked** when `WALLET_ENABLED=false` (no balance debit)
- **Clawback** on cancel/refund: lesson/booking/review points; referral first-booking when session had completed
- Game plan: one idempotency key per session (`points:game_plan:session:{sessionId}`)
- Existing wallet USD balance is unchanged; only **new** referral events use points

## QA

See [QA_POINTS_REFERRAL_PROMO.md](./QA_POINTS_REFERRAL_PROMO.md).
