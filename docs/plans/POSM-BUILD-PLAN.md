# POSM Field-Execution Platform — Build Plan (living doc)

> Single source of truth for this build. Update it in the same pass as any fact change (working agreement #7).
> **Status: 2026-08-28 — Waves 0–2 backend + FE consoles COMPLETE & RUNTIME-PROVEN.** Backend chassis + masters/ingestion + full recce→ASM-approval→install→auditor-audit pipeline + capture-integrity + media (dual-audited). **NEW this session:** the whole **frontend** — field capture (`/field/recce/[siteId]`, `/field/install/[recceId]`: native camera, `useGeo`, media upload, ghost-overlay), **ASM console `/review`**, **Auditor console `/audit`**, **Admin masters `/admin`** — built by 4 parallel sub-agents, integrated + gated. Fixes I made: 2 scale-correct scoped GETs (`/approval/recces/:id`, `/audit/installations/:id`), removed `/api/media/view` from proxy `PUBLIC_PATHS` (was 401ing every in-app photo), widened `/posm-types` read to field roles (writes stay admin-only), wired the missing audit GET route, added an env-gated (`STORAGE_DRIVER=local`) local-disk storage driver for dev/demo (prod = GCS unchanged), one global react-hot-toast `<Toaster/>`. **Gates green: backend nest build + jest 251 / FE tsc + vitest 102.** **RUNTIME-PROVEN** end-to-end vs local Postgres (`posm_dev` :5433) + API :4000 + Next :3000: login per role, admin masters render real counts through the proxy, FULL pipeline with real photo upload/store/watermark + geo-fence + before≠after, anti-fraud identical-photo block, both scoped GETs (404-scoped/403-floor/200), and `/api/media/view` → 200 image in-browser. Wave 3a committed `bc7c638`. **✅ Wave 3b (Manual workflow) DONE & RUNTIME-PROVEN** (backend `manual` module + `/admin/manual` builder/review + `/field/tasks` filler; api jest 288 · FE tsc0/vitest152; cross-fleet isolation proven; migration `20260828185347_manual_workflow`). ▶ NEXT: Wave 3c (analytics — waterfall dashboards/drill-down/geo heatmap/vendor scorecards/Excel + Vendor-HO console) then 3d (automated email) + Wave 4 hardening/50k-scale. Client **Kwality** verbal approval; owner owes scope B-vs-C + mock-GPS deliverable wording + provisioning (GCS bucket) for real-device UAT.

---

## 1. What this is
A standalone, multi-tenant field-execution product: **recce → ASM approval → installation → audit** of point-of-sale material, for a pan-India vendor fleet (7–10 scoped login IDs per vendor, ~50k sites/yr, seasonal). Built on the shared Gifsy chassis. Client identity (**Kwality**) is internal — client-facing docs stay name-free.

## 2. Architecture (settled by PLATFORM-BLUEPRINT Part 4)
- **Standalone multi-tenant PRODUCT.** Own service + own `posm` database on a **shared** Cloud SQL instance (share with OpsHub — the `gifsy-shared` pattern; instance target confirmed at provision time, schema is instance-agnostic). NOT a loyalty module.
- **Stack:** NestJS 11 + Prisma (backend `api/`, owns DB + all logic) · Next.js 16 PWA (`platform/`, proxies `/api/*` → `/v1/*`) · GCS media · MSG91 email/OTP · **OpenStreetMap** (free) + Google Maps deep-link. Cloud Run **min=0**. Region `asia-south1`. Cloudflare Worker edge.
- Diagram: the published architecture artifact.
- Pay-per-install ⇒ **DUAL adversarial audit mandatory** on the anti-fraud path; runtime-verify on real devices per role.

## 3. Decisions locked
- **Mock-GPS → Option A** (PWA-achievable). Verified in loyalty code: there is NO OS mock-provider detection; the platform uses geo-fence (inside/outside/**unverifiable**=flag), GPS-accuracy caps, dup-hash. `noGallery`/`capture=environment` are browser hints only. → Correct the proposal/Excel/demo wording before contracting.
- **Nearby-outlets** = kept, on **free OpenStreetMap**, behind a **Gifsy enable/disable toggle** (tenant setting).
- **Offline capture** = out (submit is online-only so server time + geo can't be faked — matches loyalty).
- **Deferred (not this phase):** cost/budget/tracking suite (costing matrix, PO burn-down, budget-vs-actual, payout) + route ordering. Available as a later phase.
- **Watermark** = IN (loyalty explicitly dropped it; POSM adds it).

## 4. Reuse / copy manifest (from the loyalty chassis — COPY the code, strip loyalty specifics)
Source repo: `C:\Users\nikun\Loyaltybaseclaude`.

**COPY-AS-IS (generic):**
- `api/src/common/guards/*` (Jwt/Roles/Tenant/Permission) + `decorators/*` + `common/rbac/*` + `common/tenant-scope.ts` (`platformWide`).
- `api/src/auth/*` (OTP + JWT + 7-day rolling session + refresh rotation) + `common/otp.ts` + `common/fixed-otp.ts`.
- `api/src/storage/storage.service.ts` + `common/file-signature.ts` (magic-byte sniff).
- `api/src/visibility/geo-fence.helper.ts` (haversine, `evaluatePhotoFence`).
- `api/src/visibility/{visibility-types.ts, visibility-form.helper.ts}` → the trimmed form engine, `MediaValue {key,geo}`, `readMediaValue`, `parseGpsPoint`, `gpsMaxAccuracy`.
- `api/src/visibility/visibility-media.service.ts` → upload + auth-gated view + **SHA-256 dup-hash** (rename folder prefix).
- `api/src/common/xlsx.ts` (`cellSafe`, `buildXlsx`) — CSV-injection-safe export.
- `api/src/notifications/msg91.service.ts` (`sendEmail` SMTP, `sendOtp`) + `reports/scheduled/*` harness.
- `api/src/{prisma,main.ts,app.module infra section, interceptors, filters}`.
- FE: `platform/src/{proxy.ts, lib/{api-client,auth-refresh,auth-actions,auth-client,use-permissions,utils}.ts, components/{ui/*,auth/*,rbac/*,layout/{sidebar,nav-bottom,site-footer}}, app/{layout.tsx,globals.css}}` + `next.config.ts` rewrites + `postcss.config.mjs`.
- FE capture: `components/visibility/VisibilityCaptureForm.tsx` (native camera + client JPEG compress + per-photo geotag + accuracy cap) → stage-agnostic renderer.

**COPY-AND-EXTEND (the real new build — the workflow spine):**
- Capture engine `visibility-capture.service.ts` → split single-stage into **two linked submissions** (Recce + Installation), extended status machine, **vendor-fleet scoping** replacing sales-hierarchy `descendantSalesUserIds`/`SalesUserAssignment`.
- Review `visibility-review.service.ts` → **two stages/roles**: ASM (approve recce, gates install) + separate **Auditor** (audit install).
- Reference geo → a **first-class Site.lat/lng** (loyalty bootstraps off KYC board-photo geo — POSM won't have that).
- Window helper → recce/install are **event/site-driven**, not per-month windows (drop `windowKey`, key on site + stage).
- Report/notify → **stage funnel** (recce/approved/installed/audited) + vendor-fleet breakdown.
- Bulk Excel upload pattern (`admin-programs/visibility.service.ts bulkUpload`) → site/vendor/POSM-type ingestion with the base64 error-file rejection report.

**STRIP everywhere:** loyalty role names, the permission catalog (KYC/SCHEMES/CREDITS/PAYOUTS/TDS…), `ALL_NAV_ITEMS`, `filter-bar` option arrays, `client-registry` (Deoleo), money/BigInt-paise (POSM handles no money), Gifsy/Deoleo brand strings.

**BUILD NEW (no loyalty analog):** installation stage · ASM gate · auditor console · distance recce↔install · before≠after perceptual diff · blur/exposure classical-CV · **watermark** · nearby-outlets (OSM+toggle) · manual workflow · vendor-fleet identity + assignment · dashboards/heatmap/scorecards · vendor-HO console.

## 5. Data model
See `api/prisma/schema.prisma` (v0 first cut). Chassis: `Client, User (role incl. VENDOR_FIELD + vendorId), UserSession, AuditLog`. Masters: `Vendor, Site (own geo), PosmType`. Pipeline: `Recce` + `ReccePosm` (≤2) → `Installation` + `InstallPosm` (1:1 to ReccePosm). Integrity: `ImageHash`. Manual: `ManualTask` + `ManualTaskSubmission`. Per-tenant `PosmConfig` lives in `Client.settings` (settings-backed, like `VisibilityConfig`).

**Two v0 modelling calls to confirm before building on it:**
1. **Pipeline unit** — chose *site-level Recce/Installation submissions with per-POSM child rows* (mirrors loyalty's capture+submission history + clean ASM-approves-the-recce gate). Alternative: a flat per-POSM "unit" row. Site-level fits "ASM approves the site's recce", per-POSM fits granular audit — current model keeps both (site submission + child rows).
2. **Vendor field identity** — chose *`User` rows (role VENDOR_FIELD + `vendorId`)* reusing chassis auth (the JwtPayload already carries `vendorId`), vs a separate identity table. Simpler, rides existing RBAC.

## 6. Anti-fraud posture (PWA-achievable — Option A)
Per photo: geo-fence vs **Site** reference (inside/outside/**unverifiable**=flag-never-block; outside=hard-block when enabled; missing-geo-with-reference = fail-closed) · GPS-accuracy cap (`gpsMaxAccuracy`) · SHA-256 duplicate hash (cross-site/stage flag) · clock-skew (capturedAt vs receivedAt) · media-key tenant-ownership guard. New: before≠after perceptual diff, blur (Laplacian variance), exposure. Watermark burned in at store time. NO mock-provider detection (impossible in PWA).

## 7. Build waves (▶ = parallelizable slice)
- **Wave 0 · Scaffold + chassis (sequential foundation).** Repo skeleton, package.json/tsconfig/nest+next config, Prisma init, copy the COPY-AS-IS chassis (auth, RBAC, storage, geo-fence, form engine, media, xlsx, msg91, proxy, admin shell, UI kit) and strip loyalty specifics. **Gate:** boots + api jest / nest build / platform vitest / tsc all green. Re-theme FE to the Kwality palette (red `#E3000F` / yellow `#FFD200`, rounded-2xl, mobile `max-w-md`).
- **Wave 1 · Masters + tenancy + ingestion.** `Vendor/Site/PosmType` CRUD + Excel bulk-upload with rejection report; vendor-fleet RBAC scoping (VENDOR_FIELD sees only its vendor's sites; ASM its territory). **Gate + audit.**
- **Wave 2 (▶ parallel after Wave 1):**
  - ▶ 2a **Recce field flow** — capture form (reuse) + ≤2 POSM lines + markup + dimensions + geo-fence + immutable submit-lock + nearby-outlets (OSM + Gifsy toggle) + directions deep-link.
  - ▶ 2b **ASM approval console** — queue, waterfall, bulk approve, individual approve/reject with reason codes, swipe/keyboard review, Excel export; mobile + desktop.
  - ▶ 2c **Installation flow** — linked capture, **ghost-overlay** (recce image in viewfinder), distance recce↔install.
  - ▶ 2d **Media-integrity extensions** — before≠after diff, blur/exposure flags, **watermark** (on top of copied media service + dup-hash).
- **Wave 3 (▶ parallel):**
  - ▶ 3a **Auditor console** — per-image (no bulk), recce-vs-install compare, distance chip, reason-coded reject.
  - ✅ 3b **Manual workflow** DONE (2026-08-28, commit pending) — schema reconciled (split `ManualTaskState`/`ManualSubmissionStatus`, added review/audit fields, migration `20260828185347_manual_workflow`) + backend `manual` module (admin task CRUD + form-builder schema, vendor my-tasks/submit reusing the capture form-engine validators + media, direct admin approve/reject, all tenant+**fleet-scoped fail-closed**) + admin console `/admin/manual` (list + builder + review) + vendor `/field/tasks` (my-tasks + form filler reusing the camera/geo/upload primitives). Gates api jest 288 · FE tsc0/vitest 152. RUNTIME-PROVEN incl. cross-fleet isolation (vendor B can't see/submit vendor A's task → 404-invisible; vendor→admin-detail 403) + create→submit→approve loop with real photo. `FormValue` union corrected to include `GpsCapture`.
  - ▶ 3c **Analytics** — waterfall dashboards + drill-down-to-evidence + geo heatmap + vendor scorecards + Excel report; **Vendor-HO console**.
  - ▶ 3d **Automated email** — scheduled digests + threshold reminders (reuse scheduler + MSG91 SMTP), rate-limited.
- **Wave 4 · Adoption + hardening.** Demo/training mode, in-app help, PWA install/auto-update polish; then **DUAL fraud audit**, 50k-scale test, on-device UAT per role, deploy. Scope B stops before most Wave-3 good-to-haves; scope C includes them.

Each wave: I run the FULL gates + runtime-verify + an **independent adversarial audit** (dual for the anti-fraud/pipeline-state paths). Sub-agents write code on independent slices; I integrate and own the result.

## 8. UI style (echo the Kwality Walls microsite the client liked)
Source: `C:\Users\nikun\kwality-walls-microsite`. Red `#E3000F` (header + CTAs), yellow `#FFD200` accent, green confirm; white cards, **`rounded-2xl`**, soft shadows; mobile `max-w-md` column, sticky red header w/ white logo pill; big tap targets + `active:scale-95`; **bottom-sheet modals**; emoji states; confetti on wins. Tailwind v4 (CSS-first), Geist font, `react-hook-form + zod`, `react-hot-toast`. The gift-tile pattern maps onto POSM's site-select / POSM-type-select screens. Assets in that repo's `public/`.

## 9. Gate commands (mirror loyalty)
`cd api && npx jest --no-coverage` · `cd api && npx nest build` · `cd platform && npx vitest run` · `cd platform && npx tsc --noEmit`. A red suite must block deploy.

## 10. Open items

**Wave 2 anti-fraud residuals (dual-audited 2026-08-28 — documented, NOT silently dropped):**
- **mock-GPS / geo-fence is ADVISORY** — the fence trusts client-supplied coords; a PWA cannot attest GPS. Compensating controls built: fail-closed-on-missing-geo (fence on), before≠after hard-block, impossible-travel, three-way geo cross-check, GPS-accuracy caps. Full close ⇒ native wrapper (TWA/Capacitor). This is the same fact as the owed mock-GPS deliverable-wording fix.
- **before≠after (16×16 aHash)** catches lazy/identical reuse (identical → hard-block); a determined crop/rotate/re-compress evades perceptual hashing — auditor + geo-distance are the backstop.
- **no cross-site PERCEPTUAL dedup** (exact-SHA cross-site only) — a re-compressed photo reused per site evades exact-dup. Candidate: store+compare aHash cross-site.
- **media-view is tenant-scoped, not vendor-scoped** (mitigated: unguessable keys, no in-surface path to another vendor's key). Candidate hardening: vendor-scope the view.
- **geo-fence DEFAULTS DISABLED on malformed/empty tenant settings** (deliberate — never hard-block a legit submit on misconfig). ⇒ the fence MUST be explicitly configured per tenant at go-live.

- [x] Wave 0 backend chassis built + gates independently green (generate/build/tsc/jest) + DI boots. Accepted schema config fixes: datasource `url` moved to `prisma.config.ts` (Prisma 7 rule) + added `Client.recces`/`Client.installs` back-refs (were missing — my v0 bug).
- [ ] **AUTH durability — MUST-FIX before prod:** the chassis uses an *in-memory* OTP store; Cloud Run `min=0` is multi-instance, so an OTP sent by one instance can't be verified by another. Add an `OtpCode` model + DB-backed store (loyalty pattern) during auth hardening. FIXED_OTP(123456) works for dev/staging now.
- [ ] Session simplifications (v0 schema has no `clientId` on `UserSession`, no `sessionsInvalidBefore`): assume-tenant scope reverts on the ~hourly refresh; no logout-all-before-stamp. Confirm whether POSM needs durable assumed sessions / logout-all.
- [ ] Confirm real prod/staging DB names (chassis fixed-OTP guard assumes `posm_prod`/`posm_staging`; bucket `posm-platform-files`).
- [ ] Confirm v0 schema (§5) — the two modelling calls.
- [ ] Scope package **B (~₹6.15L, Nec+Imp)** vs **C (~₹7.95L, full)** — needed before the Wave-3 good-to-haves.
- [ ] Correct mock-GPS wording in proposal/Excel/demo (pre-contract).
- [ ] Regenerate cover email to drop the deferred cost-framework highlight.
- [ ] Confirm repo path `C:\Users\nikun\gifsy-posm` (working default) + git init + remote.
- [ ] Provision-time: which shared Cloud SQL instance (share with OpsHub) + `gifsy_user` privilege split.
