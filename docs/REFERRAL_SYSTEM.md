# NetQwix referral system

Application-level referrals for **Trainer ↔ Trainee** in any direction. Rewards are wallet credits (USD minor units) issued through the existing double-entry ledger.

## Who can refer whom

| Referrer | Can invite to join as |
|----------|------------------------|
| Trainer  | Trainee or Trainer     |
| Trainee  | Trainee or Trainer     |

There is no separate “role lock”: the inviter chooses **target account type** per invite batch. The referee picks **Trainer** or **Trainee** at signup; rewards use the actual referrer/referee account types.

## Reward matrix (default USD cents)

Configurable via env vars (`REFERRAL_SIGNUP_*_MINOR`, `REFERRAL_FIRST_BOOKING_*_MINOR`). See `src/config/referral.ts`.

| Referrer → Referee | Referrer signup | Referee signup | Referrer first booking |
|--------------------|-----------------|----------------|------------------------|
| Trainer → Trainee  | $10             | $10            | $15                    |
| Trainer → Trainer  | $20             | —              | —                      |
| Trainee → Trainee  | $5              | $5             | $10                    |
| Trainee → Trainer  | $15             | $10            | —                      |

**First booking** = referee’s first **completed** session (as trainee or trainer on that booking). Paid once to the referrer.

## Architecture

```mermaid
flowchart LR
  subgraph invite [Invite]
    A[User shares code/link] --> B[POST /referral/invite]
    B --> C[(referred_user)]
  end
  subgraph signup [Signup]
    D[POST /auth/signup + code] --> E[(referral_attribution)]
    E --> F[Wallet credit signup]
  end
  subgraph lesson [Lesson]
    G[Session completed] --> H[referralService.onSessionCompleted]
    H --> I[Wallet credit first booking]
  end
  C --> D
  F --> J[(referral_reward)]
  I --> J
  J --> K[(wallet_ledger_entries)]
```

### Collections

| Collection | Purpose |
|------------|---------|
| `referred_user` | Email invites (pending → registered → qualified) |
| `referral_attribution` | One row per referee user (who referred whom) |
| `referral_reward` | Audit of each credit/skipped/failed payout |
| `user.referral_code` | Shareable code (`NQ` + 6 chars) |
| `user.referred_by_user_id` | Denormalized referrer on referee |

### API (`/referral`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/program` | Yes | Code, links, stats, reward matrix |
| GET | `/resolve/:code` | No | Public preview for signup |
| GET | `/resolve-referrer/:userId` | No | Legacy `?ref=userId` support |
| POST | `/invite` | Yes | `{ emails[], targetAccountType }` |
| GET | `/invites` | Yes | Invite history (same data as `/user/my-referrals`) |
| GET | `/rewards` | Yes | Credit history |

Legacy routes kept:

- `POST /user/invite-friend` — `{ user_email, targetAccountType? }`
- `GET /user/my-referrals`

### Mobile

- **Invite friends** screen: target type (trainee/trainer), reward amounts, share link with `?code=`
- **Signup**: passes `referral_code` / `referrer_id` from deep link

### Guards

- No self-referral
- One attribution per referee
- Email already registered → invite rejected
- Email already invited by another member → rejected
- Idempotent ledger keys per reward
- If `WALLET_ENABLED=false`, rewards recorded as `skipped` (not lost)

### Ops

- Toggle: `REFERRAL_ENABLED=false`
- Currency: `REFERRAL_CURRENCY=USD`
- Finance review: `GET /referral/rewards` + `wallet_ledger_entries` where `reference_type=referral`
