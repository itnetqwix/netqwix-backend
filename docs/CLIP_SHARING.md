# Clip sharing (friends, immediate)

## Overview

Trainers and trainees can:

1. **Upload** clips to their locker (optional trim/crop on mobile before upload).
2. **Share** one or more clips to **friends only** — copies appear in each friend's locker **immediately**.
3. Recipients see **who shared** the clip (`shared_from_user_id`) on the **Shared clips** tab.
4. Recipients may **remove** shared clips from their locker anytime (`DELETE /common/delete-clip/:id` soft-deletes).

No accept/decline step.

## Rules

| Rule | Behavior |
|------|----------|
| Friends only | Must be on sharer's `friends` list; blocked users excluded |
| Own clips only | Cannot re-share clips already received (`shared_from_user_id` set) |
| Immediate delivery | Same S3 `file_name` / `thumbnail` keys; new clip row per friend |
| Duplicate share | Same `source_clip_id` + friend → skip creating a second copy |
| Quota | Checked on **each friend** before copy |
| Max batch | 20 clips per share request |

## API (`/clips`, auth required)

| Method | Path | Body |
|--------|------|------|
| POST | `/share-requests` | `{ clipIds[], friendIds[], message? }` — copies to friends immediately |
| GET | `/share-requests/inbox` | Always `[]` (legacy; no pending queue) |
| GET | `/share-requests/outbox` | Always `[]` |

Upload with friends (`POST /storage/clips/confirm` + `shareOptions.type: "Friends"`):

- Saves to sender locker, then copies to selected friends.

## Recipient locker fields

- `shared_from_user_id` — who shared
- `shared_at` — when copied
- `source_clip_id` — sender's original clip id

`GET /common/get-shared-clips` groups by sharer.

## Mobile

- **My clips**: multi-select → share to friends
- **Shared clips**: grouped by sharer; **Remove** on each row and in the fullscreen viewer removes the copy from your locker only
- **Upload**: optional trim/crop; optional share to friends on upload
