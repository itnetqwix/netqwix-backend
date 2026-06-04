# Promo codes (platform vs coach)

## Two sponsor types

| Type | Created by | Who pays the discount | Trainee pays | Trainer net |
|------|------------|------------------------|--------------|-------------|
| **platform** | NetQwix admin | NetQwix commission margin | Reduced subtotal | Based on **full list price** |
| **trainer** | Coach (trainer) | Coach payout | Reduced subtotal | Based on **discounted** subtotal |

Referral **checkout dollar** discounts are disabled. Referral value is **points** (earn + redeem in Wallet). Promos do **not** stack with a second promo or with referral $ off.

## Validation rules

- **Platform codes**: any eligible trainee booking; not tied to a coach (`trainer_id` null).
- **Trainer codes**: `trainer_id` required; only valid when booking **that coach**.
- Limits: dates, usage caps, per-user limit, min order, booking type, location.

## Cancel / refund

When a booking is cancelled or refunded, `revertPromoUsage` decrements `usage_count` and removes the `used_by` row for that `booking_id`, so per-user limits can be used again on a new booking.

## APIs

| Audience | Endpoint |
|----------|----------|
| Trainee validate | `POST /common/validate-promo` |
| Trainee visible chips | `GET /common/visible-promos?trainer_id=` |
| Admin CRUD | `POST/GET/PUT /admin/promo-codes` (platform) |
| Trainer CRUD | `GET/POST/PUT/PATCH /trainer/promo-codes` |

## Checkout / quotes

`POST /payments/quote` accepts `promoDiscountCents` and `promoSponsorType` (`platform` | `trainer`).

## Edge cases

| Case | Behavior |
|------|----------|
| Trainer code on wrong coach | Rejected at validate |
| Expired / max uses | Rejected |
| 100% off platform promo | Trainee $0; trainer paid on list price when list > 0 |
| 100% off trainer promo | Trainee $0; trainer net $0 |
| Promo + referral $ | Referral $ = 0; points separate |
| Stacking two promos | One code per booking |
| Book → cancel → rebook same promo | Allowed after usage revert |

## QA

See [QA_POINTS_REFERRAL_PROMO.md](./QA_POINTS_REFERRAL_PROMO.md).
