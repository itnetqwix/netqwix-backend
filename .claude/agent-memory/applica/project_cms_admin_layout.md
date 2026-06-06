---
name: project-cms-admin-layout
description: How CMS admin features are wired between nq-backend and nq-admin-frontend — entities, route prefixes, and the presigned upload flow.
metadata:
  type: project
---

CMS admin surface spans two repos in this workspace:

- Backend: `src/modules/cms/*`, `src/modules/banners/*`, `src/modules/tips/*`, `src/model/cms_*.schema.ts`, `src/model/home_banner.schema.ts`
- Admin frontend: `nq-admin-frontend/src/pages/apps/{banners,tips,cms,cms-blog,cms-faq,cms-legal}/index.jsx` and `nq-admin-frontend/src/services/{bannersApi.js,cmsApi.js,tipsApi.js}`

All admin CMS endpoints live under `/admin/...` and are guarded by `AuthorizeMiddleware.authorizeUser` (mounted globally in `src/modules/admin/adminRoutes.ts`) plus per-handler `assertAdminUser(req.authUser)`. Routes:

- Banners: `GET|POST /admin/banners`, `PATCH /admin/banners/:id`, `PATCH /admin/banners/:id/toggle`, `DELETE /admin/banners/:id`
- Pages (blog + page types): `GET|POST /admin/cms/pages`, `PATCH /admin/cms/pages/:id[/toggle]`, `DELETE /admin/cms/pages/:id`
- FAQ: `GET|PUT /admin/cms/faq`, `POST /admin/cms/faq/seed`
- Legal: `GET /admin/cms/legal`, `PUT /admin/cms/legal/:slug` (slug ∈ terms|privacy)
- Summary: `GET /admin/cms/summary`
- Asset presign: `POST /admin/cms/asset-presign` with body `{ kind, contentType, fileSizeBytes, fileName }` where `kind ∈ banners|tips|pages`. Response `{ uploadUrl, mediaUrl, key, expiresIn }`. Limits: JPEG/PNG/WebP, ≤ 5 MB.

**Why:** Mobile reads `/cms/home`, `/cms/manifest`, `/cms/pages`, `/cms/legal/:slug`, `/cms/faq` (public, optional auth). The admin app mutates the same documents and bumps a content_version so signed-in clients refresh over socket and guests refresh on the ~60s manifest poll.

**How to apply:** When adding a new CMS surface, follow the existing pattern: schema in `src/model/`, controller exposing `adminListX/adminCreateX/adminUpdateX/adminToggleX/adminDeleteX` with `assertAdminUser` at the top, route in `adminRoutes.ts`, public read in `cmsController.ts`, plus an entry in `serviceApi.js` and a page under `nq-admin-frontend/src/pages/apps/`. Call `notifyCmsUpdated(kind)` after writes. For image fields, use the shared `CmsImageUpload` component (`nq-admin-frontend/src/components/admin/content/CmsImageUpload.jsx`) wired with the appropriate `kind`.

The admin sidebar lives in `nq-admin-frontend/src/navigation/vertical/index.js`; new CMS pages must be added there AND a matching `nav_cms_*` subject added to `nq-admin-frontend/src/configs/acl.js` or they will be unreachable for restricted admins.
