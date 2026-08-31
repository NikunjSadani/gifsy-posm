# POSM Field-Execution Platform — Build Plan (living doc)

> Single source of truth for this build. Update it in the same pass as any fact change (working agreement #7).
> **Status: 2026-08-28 — Waves 0–2 backend + FE consoles COMPLETE & RUNTIME-PROVEN.** Backend chassis + masters/ingestion + full recce→ASM-approval→install→auditor-audit pipeline + capture-integrity + media (dual-audited). **NEW this session:** the whole **frontend** — field capture (`/field/recce/[siteId]`, `/field/install/[recceId]`: native camera, `useGeo`, media upload, ghost-overlay), **ASM console `/review`**, **Auditor console `/audit`**, **Admin masters `/admin`** — built by 4 parallel sub-agents, integrated + gated. Fixes I made: 2 scale-correct scoped GETs (`/approval/recces/:id`, `/audit/installations/:id`), removed `/api/media/view` from proxy `PUBLIC_PATHS` (was 401ing every in-app photo), widened `/posm-types` read to field roles (writes stay admin-only), wired the missing audit GET route, added an env-gated (`STORAGE_DRIVER=local`) local-disk storage driver for dev/demo (prod = GCS unchanged), one global react-hot-toast `<Toaster/>`. **Gates green: backend nest build + jest 251 / FE tsc + vitest 102.** **RUNTIME-PROVEN** end-to-end vs local Postgres (`posm_dev` :5433) + API :4000 + Next :3000: login per role, admin masters render real counts through the proxy, FULL pipeline with real photo upload/store/watermark + geo-fence + before≠after, anti-fraud identical-photo block, both scoped GETs (404-scoped/403-floor/200), and `/api/media/view` → 200 image in-browser. Wave 3a committed `bc7c638`. **✅ Wave 3b (Manual workflow) DONE & RUNTIME-PROVEN** (backend `manual` module + `/admin/manual` builder/review + `/field/tasks` filler; api jest 288 · FE tsc0/vitest152; cross-fleet isolation proven; migration `20260828185347_manual_workflow`). **✅ Wave 3c (Analytics) DONE** (+audit fixes `c3ec666`: null-rate honesty, exact 50k-scale scorecard counts, server-side drill-down). **✅ Wave 3d (Automated email) DONE & RUNTIME-PROVEN** (backend `reports` 333 jest: per-tenant config + digest + idempotent hourly cron via `EmailDigestLog`; FE `/admin/reports`; send-now proven via SMTP DEV-bypass). **🎉 Wave 3 (b+c+d) COMPLETE.** ▶ NEXT: Wave 4 (hardening, 50k-scale test, on-device UAT per role, deploy). Owner still owes: scope decisions already made (full C built); mock-GPS deliverable wording; GCS bucket + `MSG91_SMTP_PASS` + prod env for real-device UAT/go-live. Client **Kwality** verbal approval; owner owes scope B-vs-C + mock-GPS deliverable wording + provisioning (GCS bucket) for real-device UAT.

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
  - ✅ 3c **Analytics** DONE & RUNTIME-PROVEN (2026-08-28, commit pending) — backend `analytics` module (summary/KPIs + vendor scorecards + geo points + drill-down records + xlsx export; role-scoped fail-closed via `resolveScope`) + admin `/admin/analytics` (KPI cards + execution funnel + leaflet site map + scorecards + drill-down + Excel) + read-only **Vendor-HO console `/vendor`** (same widgets, fleet-scoped). Gates api jest 308 · FE tsc0/vitest176. RUNTIME-PROVEN incl. **VENDOR_HO fleet-isolation** (scorecards/geo/summary show ONLY own fleet; `records?vendorId=<foreign>` fail-closed to own fleet; admin sees both vendors) + browser render of both dashboards + valid xlsx export.
  - ✅ 3d **Automated email** DONE & RUNTIME-PROVEN (2026-08-28, commit pending) — backend `reports` module: per-tenant config in `Client.settings.emailReports` (recipients/enabled/sendHourLocal-IST/stale thresholds, merge-no-clobber, case-insensitive dedup) + tenant-scoped digest counts + self-contained HTML + `preview`/`send-now` endpoints + hourly `@Cron` idempotent via `EmailDigestLog @@unique([clientId,digestType,forDate])` (ledger claimed only after recipients check; P2002→skip; IST from UTC offset, host-TZ-robust). FE `/admin/reports` (recipients/hour/thresholds + sandboxed-iframe preview + Send-test). Reuses `Msg91Service.sendEmail` (DEV bypass logs when `MSG91_SMTP_PASS` unset). Migration `20260828204736_email_digest_log`. Gates api jest 333 · FE tsc0/vitest187. RUNTIME-PROVEN: config round-trip+dedup, preview real counts, send-now → DEV-bypass log rendered the digest to recipients. ▶ owner: set `MSG91_SMTP_PASS` + recipients at go-live to activate real sends.
- **Wave 4 · Adoption + hardening.** Demo/training mode, in-app help, PWA install/auto-update polish; then **DUAL fraud audit**, 50k-scale test, on-device UAT per role, deploy. Scope B stops before most Wave-3 good-to-haves; scope C includes them.
  - ✅ **50k-scale test PASSED (2026-08-31)** — seeded a single 50k-outlet tenant (50k sites / 40k recces / 24k installs, ~114k rows, in 34s) and timed every heavy endpoint: analytics summary 0.30s · vendor-scorecards 0.37s (the 3c `groupBy` fix carries it) · geo (5000-cap, 1.1MB) 0.08s · records/drill-down 0.03s · Excel export 0.49s · sites list 0.07s · digest preview 0.02s · approval queue (8k pending) 0.06s · audit queue (4k pending) 0.02s · deep pagination (sites p900 / records p150) <0.07s. **No cliffs, no index gaps — all <0.5s.** Scale seed = `scratchpad/scale-seed.mjs` (throwaway; scale tenant deleted, demo DB restored clean). ▶ still owner-gated: on-device UAT per role, prod deploy.

Each wave: I run the FULL gates + runtime-verify + an **independent adversarial audit** (dual for the anti-fraud/pipeline-state paths). Sub-agents write code on independent slices; I integrate and own the result.

## 8. UI style (echo the Kwality Walls microsite the client liked)
Source: `C:\Users\nikun\kwality-walls-microsite`. Red `#E3000F` (header + CTAs), yellow `#FFD200` accent, green confirm; white cards, **`rounded-2xl`**, soft shadows; mobile `max-w-md` column, sticky red header w/ white logo pill; big tap targets + `active:scale-95`; **bottom-sheet modals**; emoji states; confetti on wins. Tailwind v4 (CSS-first), Geist font, `react-hook-form + zod`, `react-hot-toast`. The gift-tile pattern maps onto POSM's site-select / POSM-type-select screens. Assets in that repo's `public/`.

## 9. Gate commands (mirror loyalty)
`cd api && npx jest --no-coverage` · `cd api && npx nest build` · `cd platform && npx vitest run` · `cd platform && npx tsc --noEmit`. A red suite must block deploy.

## 10. Open items

**Wave 2 anti-fraud residuals (dual-audited 2026-08-28 — documented, NOT silently dropped):**
- **mock-GPS / geo-fence is ADVISORY** — the fence trusts client-supplied coords; a PWA cannot attest GPS. Compensating controls built: fail-closed-on-missing-geo (fence on), before≠after hard-block, three-way geo cross-check, GPS-accuracy caps. Full close ⇒ native wrapper (TWA/Capacitor) — **but web research (2026-08-31) confirms even NATIVE `isMock`/`isFromMockProvider` is not foolproof (false negatives, bypassable); best practice = defense-in-depth on either platform, so the softened deliverable wording is honest regardless.** Deliverable wording corrected 2026-08-31 (docx `POSM-Proposal-Polished-corrected.docx` + web HTML source; Excel already clean).
- **impossible-travel REMOVED (2026-08-31)** from wording AND code (`isImpossibleTravel`/`impliedSpeedKmh` deleted from image-integrity.helper + capture-integrity.service + installation.service qualityFlags + audit FE chip + tests) — a vendor login ID may be SHARED by multiple field reps, so consecutive captures from different people would read as impossible travel and raise false fraud flags. The other signals don't depend on one-person-per-ID.
- CANDIDATE (owner-considering): a PWA-achievable **GPS-vs-IP-location cross-check** as an advisory signal (explanation + false-positive analysis given to owner; not yet built).
- **before≠after (16×16 aHash)** catches lazy/identical reuse (identical → hard-block); a determined crop/rotate/re-compress evades perceptual hashing — auditor + geo-distance are the backstop.
- **no cross-site PERCEPTUAL dedup** (exact-SHA cross-site only) — a re-compressed photo reused per site evades exact-dup. Candidate: store+compare aHash cross-site.
- **media-view is tenant-scoped, not vendor-scoped** (mitigated: unguessable keys, no in-surface path to another vendor's key). Candidate hardening: vendor-scope the view.
- **geo-fence DEFAULTS DISABLED on malformed/empty tenant settings** (deliberate — never hard-block a legit submit on misconfig). ⇒ the fence MUST be explicitly configured per tenant at go-live — now done via the **admin portal** (`/admin/settings`, `GET`/`PUT /v1/settings/capture` → merges `Client.settings.posmCapture` through the same `posm-config.helper` the capture lanes read: enforce toggle + radius m [e.g. 500] + GPS-accuracy cap; runtime-verified round-trip; tenant-scoped; bounds-validated).

**Wave 3b manual-workflow residuals (adversarial-audited 2026-08-28 — 2 HIGH + 1 MEDIUM fixed & runtime-verified; scoping/race/unique-constraint confirmed solid):**
- FIXED HIGH: admin task-list & task-detail pages crashed on a FE↔BE shape mismatch (`counts`↔`submissionCounts`; `getTask` returns FLAT not `{task}`) — my under-specified agent contract; FE aligned to the tested backend + browser-verified.
- FIXED MEDIUM: the reused `validateFormSchema` forced a CAMERA field (a visibility assumption) — now `requireCamera` opt-out so a manual survey/checklist can be photo-less; runtime-verified (201).
- RESIDUAL LOW (accepted): formSchema edit-lock is a narrow count-then-update TOCTOU — display-only (answers rendered against a swapped schema), no security/data effect; not worth a row-lock for a manual task (commented in `updateTask`).
- RESIDUAL LOW (accepted): manual submissions skip same-tenant duplicate-photo detection (no `ownerKind:MANUAL` hash recorded) — cross-tenant reuse still blocked by tenant-scoped `viewMedia`; manual isn't a payout path. Candidate: record ImageHash on submit + surface a dup flag in review.

**Wave 3d email-digest residuals (adversarial-audited 2026-08-28 — cross-tenant leakage CLEAN; MED×2 + LOW×2 fixed, 2 documented):**
- FIXED MED: transient SMTP failure would permanently drop that day's digest (ledger claimed before send, never rolled back) → now the cron fires from `sendHourLocal` ONWARD and rolls back the ledger claim on send failure (at-least-once within the day; still exactly-once on success). FIXED MED: `send-now` had no per-endpoint throttle (loopable bulk relay) → `@Throttle(3/min)`. FIXED LOW: recipient cap now on the cron read path too (`MAX_RECIPIENTS=50`, not just the DTO). FIXED LOW/MED: `putConfig` settings read-modify-write wrapped in a transaction (window shrunk).
- RESIDUAL LOW (documented): the `Client.settings` blob update is not hard-locked — a fully race-safe fix (SELECT…FOR UPDATE / JSON-path write) is a shared settings-layer concern across every settings editor, not email-specific.
- RESIDUAL LOW (documented): `send-now` still emails the admin-configured recipient list, which may legitimately be external ops addresses — inherent to the feature; the 3/min throttle + 50-cap bound the abuse rate.
- RESIDUAL LOW (documented): `EmailDigestLog.meta` retains recipient emails indefinitely (no 90-day prune like the delivery tables). Candidate: a retention job, or drop recipient PII from `meta` (keep counts only).

**Whole-platform E2E + UI/UX audit (2026-08-31 — 4 lanes: 3 UI/UX by surface + 1 adversarial-correctness on the never-audited Wave-3a consoles; fixed via 4 parallel fix agents, all gates green + CRITICALs runtime-verified):**
- FIXED CRITICAL: ASM recce-DETAIL page crashed on every recce — `photo-viewer.tsx` rendered the `dimensions` JSON object as a React child (FE type said `string`). Now a `dimensionsLabel()` helper + `dimensions: unknown`. Detail is the only reject path, so this unblocked the whole ASM reject flow. **Runtime-verified** ("Dimensions: 3 × 2 ft").
- FIXED CRITICAL: field `/field/work` was a dead "coming soon" placeholder and the install screen was unreachable → built a real My Work list (recces grouped by status; APPROVED → the sole nav path to `/field/install/[recceId]`; REJECTED → re-capture). **Runtime-verified.**
- FIXED HIGH: rejected recces were a dead end — wired the `POST /recce/:id/resubmit` path (was always POST /recce → 409). FIXED HIGH: double-submit races (recce/install/task/login) → synchronous `useRef` in-flight guards. FIXED HIGH: admin sites truncated at 200 + client-side status filter → real pagination + a backend `status` filter on `ListSitesDto`/`sites.service` (tenant-scoped; **runtime-verified**). FIXED HIGH: auditor queue had no pagination (installs #51+ unreachable) → paginated like review. FIXED HIGH (misleading): review "flagged" count was page-scoped but shown vs the server total → honest "N flagged on this page".
- FIXED MEDIUM (a11y/consistency): Select label association app-wide (`ui/select.tsx`), Esc + focus-trap on dialogs/drill-down/lightboxes, lightbox image error fallback, review "Location not verified" geo chip + geo colors standardized (inside=green/outside=amber-advisory/not-verified=gray), reject-"Other" requires a note in review too, pinch-zoom re-enabled (WCAG 1.4.4), duplicate dup-photo banner removed, various label associations.
- RESIDUAL (owner-descoped): offline draft / capture persistence — a captured-but-unsubmitted recce/install lives only in React state (owner cut offline earlier). Orphaned media on an abandoned/rejected submit is harmless (hashes recorded only on submit).
- RESIDUAL LOW (documented): recce list carries no installation linkage + an install doesn't flip `recce.status`, so My Work shows "Start installation" on an already-installed APPROVED recce (the install screen's 409 catches it honestly). Candidate: add installation status to the recce list response. Also: task-builder Description/Due-date labels + VendorScorecards keyboard-sort (out of the fixing agents' scope), the admin Overview counting via full small-list fetches (accepted — small entities), and the header logo `/_next/image` 400 (Next image-optimizer config on the logo — cosmetic, pre-existing).

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
