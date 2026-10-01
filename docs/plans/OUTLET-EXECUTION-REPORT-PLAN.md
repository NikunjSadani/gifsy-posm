# Outlet Execution Report — build plan & living state

Owner ask (2026-09-30): an admin-portal report, one row per outlet, with the 36 columns in
the pasted spec. Reconciling the columns against the data model surfaced that 3 columns depend
on subsystems that don't exist yet. Owner decisions (via clarifying Q&A) resolved every fork:

| Fork | Owner decision |
|---|---|
| **HO Approval** | A NEW escalation stage: when the **Auditor rejects**, the installation escalates to **HO/Admin (CLIENT_ADMIN)**. HO **approve** → final approved (overrides the audit reject). HO **reject** → **terminal REJECTED**. HO is only involved after an audit rejection. |
| **Direct Installation** | Forward-looking flag tied to a future manual direct-install workflow. Add `isDirect` on the installation (default false → column reads "No" today); it lights up when that workflow lands. |
| **6 master fields** (Region, State, Cluster, Beat Name, Channel, Address) | Add all 6 to the `Site` schema + outlet-upload template + create/edit form. Owner populates them in the outlet master. |
| **Promoter ID** | Add a real `promoterCode` to the user master (field users); owner supplies it. Report shows the recce submitter's and install submitter's codes. |
| **Sequencing** | **Build it all, then ship** (one coherent delivery). |

## Column → source map (final)

Site = the outlet master. One report row per Site (coverage report; filterable).

| Column | Source / derivation |
|---|---|
| Vendor Name | `site.vendor.name` |
| Recce Promoter ID | `recce.submittedBy.promoterCode` (fallback "—") |
| Install Promoter ID | `installation.submittedBy.promoterCode` |
| Region / State / Cluster | `site.region` / `site.state` / `site.cluster` **(NEW)** |
| Town | `site.town` |
| RS Code | `site.rsCode` |
| Beat Name | `site.beatName` **(NEW)** |
| Outlet Code / Name | `site.code` / `site.name` |
| Channel | `site.channel` **(NEW)** |
| Address | `site.address` **(NEW)** |
| Lat Long | `site.lat`, `site.lng` |
| Direct Installation | `installation.isDirect` **(NEW)** → Yes/No (No today) |
| Element 1 / 2 | `reccePosm[slot].posmType.name` |
| Element N Recce Status | `recce.status` (element shares the recce's fate) |
| Element N Recce Time & Date | `recce.capturedAt` (site-level; same for both elements — model has no per-POSM timestamp) |
| Element N Recce Location | `reccePosm[slot].photo.geo` → "lat, lng" (fallback recce.captureLat/Lng) |
| Element N Installation Status | installPosm present ? `installation.status` : "Not installed" |
| Element N Installation Time & Date | `installation.capturedAt` |
| Element N Installation Location | `installPosm.captureLat/Lng` |
| Element N Recce↔Install distance | `installPosm.distanceFromRecce` |
| Outlet Recce Status | `recce.status` (or "Not started" if no recce) |
| ASM Approval Status | derived from `recce.status` + `approvedById` (Approved/Rejected/Pending/—) |
| HO Approval Status | `installation.hoReviewStatus` **(NEW)** → N/A / Pending / Approved / Rejected |
| Installation Status | installation present ? "Submitted" : "Not installed" |
| Audit Status | `installation.status` → Approved / Rejected / Pending audit / — |

## Modeling choices (within the agreed design)

- **HO stage = a separate `hoReviewStatus` field on `Installation`**, NOT new `InstallationStatus`
  enum values. So "Audit Status" (the auditor's decision, an immutable fact) and "HO Approval
  Status" (the escalation outcome) stay orthogonal and map 1:1 to the two report columns. The
  auditor's `AUDIT_REJECTED` is never rewritten when HO later approves — the report tells the
  truth on both columns.
  - `enum HoReviewStatus { NONE, PENDING, APPROVED, REJECTED }` (default `NONE`).
  - Auditor `reject()` also sets `hoReviewStatus = PENDING` (escalate) in the same tx.
  - New `HoReviewService`: `listQueue` (AUDIT_REJECTED + PENDING), `approve` (→ APPROVED, terminal),
    `reject` (→ REJECTED, terminal). Actor = CLIENT_ADMIN (+ un-assumed/assumed GIFSY_ADMIN).
    Status-guarded writes + atomic AuditLog, mirroring AuditReviewService.
- **Direct install = `Installation.isDirect Boolean @default(false)`.** No path built yet.
- **Promoter code = `User.promoterCode String?`**, `@@unique([clientId, promoterCode])` (Postgres
  allows multiple NULLs, so existing users are fine). Surfaced in user create/edit only (no bulk
  user upload exists).

## Phases (gate + commit each)

1. **Schema + migration** — Site +6, User +promoterCode, Installation +hoReviewStatus/hoReviewedById/
   hoReviewedAt/hoRejectionReason/isDirect + `HoReviewStatus` enum. `prisma generate`, migrate.
2. **Outlet master** — bulk-upload template +6 cols (parse/create/update), create/edit DTO+service+FE form.
3. **Promoter code** — User create/edit DTO+service+FE form.
4. **HO stage (backend)** — escalate on audit reject; HoReviewService+controller+DTO+perms+tests. DUAL audit (auth path).
5. **HO stage (FE)** — admin HO-review queue (list + detail + approve/reject), mirroring the auditor console.
6. **Report** — reports API endpoint (per-outlet rows + filters + xlsx) + FE admin report page + download.
7. **Seed + verify** — seed the new fields/codes + a direct/HO example; runtime-verify the report + HO flow end-to-end; independent adversarial audit (DUAL on the HO path).

## Status log
- 2026-09-30: plan written; forks resolved with owner. Starting Phase 1.
- 2026-09-30: **ALL 7 PHASES COMPLETE, gated + runtime-verified + adversarially audited.**
  Commits: schema+migration → sites master fields → promoter code → HO stage (backend) →
  HO console (FE) → report (API+FE+xlsx). Gates green throughout (api jest 379, FE vitest 281).
  Runtime-verified (real endpoints, real CLIENT_ADMIN auth):
    - Report: 36 columns, correct values (A8: vendor/promoter/master/latlng/element/status all ✓).
    - HO escalation BOTH branches: auditor reject → escalate (PENDING) → HO **approve** leaves
      Audit=Rejected + HO=Approved (independence proven); HO **uphold** → Audit=Rejected +
      HO=Rejected; both re-decide → 409 (idempotent). Two-element outlet (A5) maps both elements.
    - xlsx export: valid file (200, correct type+disposition, PK-zip); jsonToSheetSafe = formula-
      injection safe for user-supplied outlet names/addresses.
    - New-Site form renders all 6 master fields; users form has promoter code.
  Adversarial audit found NO defects (escalation design + guards + scoping all sound).
  ⚠️ Runtime verification MUTATED local demo data: A8 = AUDIT_REJECTED + HO APPROVED (override
  example); A5 = AUDIT_REJECTED + HO REJECTED (uphold example). Reset via re-seed if needed.
  ▶ OWNER-GATED next steps (not built): (1) the manual DIRECT-INSTALL workflow that flips
  Installation.isDirect (the column is wired + reads "No" until then); (2) owner populates the
  6 master fields + promoter codes in the real outlet/user masters (only A8/A9 + 2 users seeded
  as samples locally).

## Follow-on: User bulk upload (2026-09-30)

Owner asked how users are created (answer: single-record UI only, no bulk) and to add bulk upload
— so promoter codes can be backfilled across the fleet by Excel rather than one form at a time.

- **`POST /v1/users/bulk-upload`** (FileInterceptor, 5 MB) mirrors the sites upload: case-insensitive
  headers `phone,name,role,vendor_code,promoter_code` (req: phone/name/role), per-row validation,
  base64 rejection report, 5 MB / 5000-row caps, one `$transaction` + IMPORT audit row.
- **Auth-safety difference (deliberate):** upsert by (clientId, phone) — a NEW phone is CREATED with
  full role/vendor/promoter; an EXISTING phone updates **name + promoterCode ONLY** (promoter
  present-gated). role / vendorId / isActive are NEVER written on the update branch, so a bulk
  upload can't trigger mass session-eviction or a last-admin lock-out. Use Edit for role/vendor.
- Validation: 10-digit Indian mobile → E.164; role ∈ MANAGED_ROLES; vendor-linkage (VENDOR_* need an
  active tenant vendor_code, others must be blank); promoter_code unique per tenant (within-file +
  vs existing, different-owner) + within-file phone de-dup. Vendors + existing users preloaded once.
- FE: `UploadPanel` generalised to props (title/description/headers/requiredHeaders/hint/upload) and
  reused on BOTH Sites and Users; `usersApi.bulkUpload`; `USER_UPLOAD_HEADERS`.
- Files: api `users.constants.ts` (new), `users.service.ts` (+bulkUpload/buildUserErrorFile),
  `users.controller.ts` (+route), `users-bulk-upload.spec.ts` (new, 8 tests); FE `upload-panel.tsx`,
  `lib/admin/{api,types}.ts`, `admin/{sites,users}/page.tsx`.
- Gates: api jest 387 (users 36, +8), FE vitest 281, both tsc 0. Runtime-proven through the
  authenticated proxy with a real .xlsx: created a new ASM, updated an existing user's promoter
  code, and a row attempting to change an existing auditor's role → role stayed AUDITOR (auth-safety).
  ⚠️ demo mutation: created user `9800000055` (Bulk ASM) + set auditor `9000000002` promoter=`PAUD`.

### Downloadable template (2026-10-01)

- **`GET /v1/users/bulk-upload/template`** — a header-only .xlsx (`phone,name,role,vendor_code,
  promoter_code`) streamed as a StreamableFile (attachment), built with `aoaToSheetSafe` so the
  columns match the uploader EXACTLY → download → fill → re-upload round-trips. `buildUploadTemplate()`
  on the service; +1 unit test (valid PK-zip, 1 header row).
- FE: `UploadPanel` gained an optional `templateUrl` (+ `templateFileName`) → a "Download template"
  button (fetch auth-gated blob → save). Wired on the Users panel; generic so Sites can add it in
  one prop later. Gates: api jest 388, FE vitest 281, both tsc 0.
- Runtime-proven: endpoint returns 200 + valid header-only xlsx; the UI button renders, and a click
  fetches + triggers the `user-upload-template.xlsx` download with no error.
