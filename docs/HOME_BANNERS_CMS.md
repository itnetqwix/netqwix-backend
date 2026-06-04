# Home banners CMS

Admin-managed banners drive the mobile marketplace home without app releases.

## Placements

| Placement | Mobile surface |
|-----------|----------------|
| `hero` | Horizontal carousel under the search header |
| `strip` | Compact announcement strip (login + legacy strip) |
| `sticky_bottom` | Slim promo bar above the tab bar |

## API

- Public: `GET /banners?placement=hero|strip|sticky_bottom`
- Admin: CRUD under `/admin/banners` (same `placement` + `auto_advance_sec` fields)

## Fields

- `placement` — required for new rows (defaults to `hero`)
- `auto_advance_sec` — hero carousel interval (0–60, default 5)
- `audience`, `sort_order`, schedule, `image_url`, `ctas`, `dismissible`

`CMS_UPDATED` socket event refreshes mobile caches when admins publish changes.
