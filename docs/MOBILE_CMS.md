# Mobile CMS API

Public routes (mounted at `/cms`):

- `GET /cms/manifest` — `{ content_version, legal, faq_version, updated_at }`
- `GET /cms/faq` — mobile FAQ sections (empty `sections` until admin publishes)
- `GET /cms/legal/:slug` — `terms` | `privacy` → HTML body
- `GET /cms/pages?type=blog` — list (audience-filtered, optional auth)
- `GET /cms/pages/:slug?type=blog` — detail with `body_html`

Admin routes (JWT admin, mounted at `/admin/cms`):

- `GET /admin/cms/legal`, `PUT /admin/cms/legal/:slug`
- `GET /admin/cms/faq`, `PUT /admin/cms/faq`, `POST /admin/cms/faq/seed`
- `GET /admin/cms/pages`, `POST /admin/cms/pages`, `PATCH /admin/cms/pages/:id`, `PATCH …/toggle`, `DELETE …/:id`

Banners support optional `ctas[]` (max 4) alongside legacy `cta_label` / `cta_url`.

**Instant refresh:** admin mutations call `notifyCmsUpdated()` → Socket.IO `CMS_UPDATED` broadcast. Signed-in mobile apps invalidate React Query `content/*` keys; guests still use manifest poll (~60s).

See also: `nq-mobile/docs/MOBILE_CMS.md`.
