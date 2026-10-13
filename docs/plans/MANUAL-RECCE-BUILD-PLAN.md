# Manual Recce — Build Plan (Wave A + Wave B, phased)

**Status:** Wave A ✅ + Wave B ✅ DONE — on `develop`, pushed to STAGING.
- Wave A `8fb4751`: schema + manual capture + attach + HO + install re-key; runtime matrix 20/20.
- Wave B `246137d`: report (one row per recce + "Recce Mode" App/Manual col), analytics, manual-recce
  Playwright spec (8/8), + dual adversarial & UI/UX audits APPLIED. Gate-green (api 487 jest, platform 323
  vitest). HIGH audit bugs fixed + tested: HO can't rename an established outlet's Outlet ID (provisional-only
  finalize); manual recces now visible + re-capturable in field My Work. D3 no-scroll verified @360/375.
- ⏳ Staging deploy of `246137d` in flight at write time — confirm all 3 Cloud Run services serve it @100%.
- ✅ **HO ATTACH-TO-EXISTING (follow-up, owner-requested)** — on an Outlet-ID collision HO can now ATTACH the
  manual recce to the existing outlet (re-parent, no duplicate/rename) instead of only "change the ID". Guards
  from the dual adversarial audit: F1 re-fence the capture geo against the target (out-of-fence blocks when the
  tenant fence is on, else flagged); F2 target must be ACTIVE; F3 only a provisional walk-in can attach (never
  MOVE an established-outlet recce); F4 the orphan-outlet deactivation is audited; same-fleet only. F5 RESOLVED
  (attaching onto a FLEET-LESS target now succeeds and the outlet ADOPTS the recce's fleet — a different fleet
  is still blocked; keeps the attached recce installable + the master consistent; audited). Attach runtime 12/12
  + e2e step 9.
- ✅ **ANALYTICS DASHBOARD TILES** (owner-requested): the admin analytics summary now exposes `kpis.pendingHoReview`
  (the HO queue count — app ASM-approved-awaiting-HO + manual awaiting-HO) and `byRecceMode {app, manual}`; the
  dashboard KPI grid renders "Pending HO approval" + "Recces via app" + "Recces via manual" tiles ("Pending recce
  review" relabeled "Pending ASM review"). Runtime-verified (app+manual == recced).
- 🔸 Owner decision still open: report layout defaulted to row-per-recce (confirm at UAT).
- 🔸 Pre-existing (NOT this feature): `field-filter.spec` false-fails on a non-fresh local DB (Site A1 already
  has a recce → correctly hidden from "recce to do"); tracked as a separate task. Prod deploy = owner-gated.
**Owner:** Nikunj. **Orchestrator:** Claude (runs gates, integrates, owns the verified result).
**Created:** 2026-10-09.
**Related:** `OUTLET-EXECUTION-REPORT-PLAN.md` (the report this extends), the recce→ASM→HO→install→audit pipeline (LIVE), `recce-ho-review` module (LIVE).

---

## 1. What we're building (one line)

A second **recce entry path for the field executive** — "Manual" — for outlets that may not be in the
master. The field exec types a few outlet fields (only **Outlet Name** required), does the **identical**
element capture, and the recce goes **straight to HO** (no ASM). HO approval requires a (mandatory,
editable) **Outlet ID**. After HO approval, **installation + audit are the exact same existing flow**.
An outlet may have **one app recce but unlimited manual recces** (different elements, different times).
The execution report gains an **App vs Manual** classification.

This is NOT the generic `manual/` admin survey module (that stays as-is), and NOT a direct-install
(the earlier `Installation.isDirect` idea is explicitly **not** this — leave `isDirect` dormant).

---

## 2. Locked decisions (from owner Q&A, 2026-10-09)

| # | Decision |
|---|---|
| D1 | **Entry = field executive.** "Manual" is a new field-app recce path, not an admin task. |
| D2 | **Recce form fields:** Outlet ID *(optional)*, **Outlet Name (REQUIRED)**, Outlet Address *(opt)*, Outlet Phone *(opt)*. Everything else about the recce (element type, dimensions, photo, compulsory markup) is **identical** to the built recce. |
| D3 | **UI/UX: one screen, no scrolling.** Reuse the accordion/collapse pattern already built for the recce capture card. |
| D4 | **No ASM stage for manual.** Field submit → **HO admin** approval directly. (App recces keep ASM→HO.) |
| D5 | **HO approval:** **Outlet ID is mandatory + editable** at HO. HO fills it if the field exec didn't; HO can edit it either way. Individual approve/reject only (no bulk — matches the app recce-HO decision). Reject needs a reason code; reasons appear in the report. |
| D6 | **Outlet IDs are unique in the master.** If an entered Outlet ID matches an existing outlet → **warn**, **prefill name/address/phone (read-only) from the master**, and **attach** this recce to that existing outlet (no duplicate outlet row). Applies both at field-entry and at HO edit. |
| D7 | **One app recce per outlet; unlimited manual recces per outlet.** Manual recces recur because different elements are installed at different points in time. |
| D8 | **Outlet row created at submit**, flagged manual/pending; Outlet ID finalized at HO. |
| D9 | **Installation + audit unchanged in behaviour** — manual and app recces are indistinguishable downstream, EXCEPT install must now target a specific recce (see §4 ripple R1). |
| D10 | **Report:** add a per-recce **App vs Manual** classification column. Because an outlet can be BOTH, the classification is per recce/installation, not purely per outlet (see §7). |

---

## 3. Glossary / where things live (confirmed in code)

- **Outlet master = the `Site` model** → table `sites` (`api/prisma/schema.prisma:201`). Admin screen
  `platform/src/app/admin/sites/page.tsx` (header reads "Sites"; fields labelled "Outlet …").
  Backend `api/src/sites/sites.service.ts` + `sites.controller.ts` (`/v1/sites`). `code` = **Outlet ID**,
  unique per tenant (`@@unique([clientId, code])`).
- **Recce** = `Recce` + `ReccePosm` (slots 1–2, so the 2-element cap is **per recce** — good, no change).
  `@@unique([clientId, siteId])` = one live recce per outlet (to be relaxed, see R2).
- **HO review (recce)** = `api/src/recce-ho-review/` module + `platform/src/app/admin/recce-ho-review/`.
- **Install** = `api/src/installation/` + field `platform/src/app/field/work` surface.
- **Execution report** = `api/src/reports/outlet-execution.helper.ts` (+ `.spec`), one row per outlet today.

---

## 4. Architectural ripples (the real size drivers — trace-every-consumer)

**R1 — Installation must become recce-keyed, not site-keyed.**
`installation.service.ts:82` does `recce.findUnique({ where: { clientId_siteId } })` — it assumes exactly
one recce per site. With unlimited manual recces, the installer must say **which** approved recce they're
installing. Change: install submit DTO carries `recceId` (fall back to the single app recce when omitted,
for backward-compatible app behaviour); the field install UI lists the outlet's **installable recces**
(status APPROVED + hoReviewStatus APPROVED + no installation yet) and the exec picks one. `Installation`
already carries `recceId @unique`, so the data model already supports many installs per outlet.

**R2 — Relax one-recce-per-outlet to app-only.**
Replace `@@unique([clientId, siteId])` with a **partial unique index**:
`CREATE UNIQUE INDEX ... ON recces (clientId, siteId) WHERE "recceMode" = 'APP'`.
Keeps one app recce per outlet; allows unlimited manual. Existing rows backfill `recceMode='APP'` so the
partial unique still holds for them. **Prisma note:** partial unique indexes aren't expressible in the
Prisma schema block — declare it via raw SQL in the migration and drop the old `@@unique` from the model
(the model keeps a plain `@@index([clientId, siteId])`).

**R3 — Consumers of the "one recce per site" assumption to update:**
- `installation.service.ts:82` (R1).
- `analytics.service.ts:395` — comment "0 or 1 (one live recce per site)"; selection must handle N recces.
- `recce.service.ts` create/resubmit path (`clientId_siteId` lookup) — app path unchanged; manual path
  must NOT collide on that key.
- `outlet-execution.helper.ts` — per-outlet → per-recce rows (§7).
- Approval queue (`approval.service.ts recceWhere`) — must **exclude manual recces** (they skip ASM).

**R4 — Manual recce "pending HO" state (no ASM to set APPROVED).**
On manual submit: `status=SUBMITTED, hoReviewStatus=PENDING, recceMode=MANUAL`. HO queue filter widens to:
`(status=APPROVED AND hoReviewStatus=PENDING)` **[app]** OR `(recceMode=MANUAL AND status=SUBMITTED AND
hoReviewStatus=PENDING)` **[manual]**. HO **approve on a manual recce sets BOTH** `status=APPROVED` and
`hoReviewStatus=APPROVED` (so the install gate `status===APPROVED && hoReviewStatus===APPROVED` passes
unchanged). HO reject on manual → `status=REJECTED, hoReviewStatus=REJECTED` (back to the field exec, who
re-captures — mirrors the app recce-HO reject).

**R5 — Geo-fence for brand-new manual outlets.**
A newly-created manual outlet has no `lat/lng`, so `geoFenceOk=null` (unverifiable → flag, not block) —
already the existing null behaviour, no new code. An **attached** existing outlet that has coordinates IS
fenced normally.

---

## 5. Data model changes (Wave A)

```prisma
enum RecceMode { APP MANUAL }

model Recce {
  // ...
  recceMode RecceMode @default(APP)   // APP = existing in-app recce; MANUAL = field-typed outlet
  // DROP @@unique([clientId, siteId]); keep a plain index:
  @@index([clientId, siteId])
  // ...
}
```

Migration (`add_manual_recce`):
1. `ALTER TYPE`/create `RecceMode`; add `recceMode` column default `APP`.
2. Backfill: `UPDATE "recces" SET "recceMode"='APP';` (explicit, though default covers it).
3. `DROP` the existing `recces_clientId_siteId_key` unique; `CREATE UNIQUE INDEX
   "recces_app_one_per_site" ON "recces"("clientId","siteId") WHERE "recceMode"='APP';`
4. `prisma generate` **before** running any gate (durable lesson).

Site: no new column strictly required — "manual/pending" is derivable (a Site whose only recces are
MANUAL and that still carries a provisional code). If the report/UX needs a cheap flag, add
`Site.provisional Boolean @default(false)` set true on manual-created outlets and cleared when HO writes a
real Outlet ID. **Decide during A1** (prefer derivable; add the flag only if a query gets ugly).

Provisional code: when Outlet ID blank at submit, `code = 'MAN-' + cuid()` (internal, unique). HO writing
the real Outlet ID overwrites `code` after the exists-check.

---

## 6. Locked API contracts (so parallel agents don't drift)

All under the existing `/v1` prefix; all tenant-scoped + role-gated as noted.

- **`POST /v1/recce/manual`** (VENDOR_FIELD) — body:
  `{ outletId?: string, outletName: string, outletAddress?: string, outletPhone?: string,
     posms: [ { posmTypeId, dimensions, photo:{key,geo}, markup } ] }`
  → provisions-or-attaches the Site (vendor from caller), creates the Recce with
  `recceMode=MANUAL, status=SUBMITTED, hoReviewStatus=PENDING`. Returns the created recce (same shape as
  the app recce submit response + `recceMode`). `outletName` required → 400 if blank.
- **`GET /v1/sites/lookup?outletId=…`** (VENDOR_FIELD + CLIENT_ADMIN/GIFSY_ADMIN) — returns
  `{ exists: boolean, site?: { id, code, name, address, phone } }` for the warn-and-prefill UX (D6).
- **`GET /v1/recce-ho-review/recces?mode=all|app|manual`** — queue, widened per R4; each item gains
  `recceMode` + `outletId` (= site.code or null if provisional).
- **`POST /v1/recce-ho-review/recces/:id/approve`** (CLIENT_ADMIN/GIFSY_ADMIN) — body now accepts
  `{ outletId: string }`. **Mandatory for manual recces** (400 if the recce is manual and neither the
  recce's outlet already has a real code nor the body supplies one). Runs the exists-check (D6): if the
  outletId matches a DIFFERENT existing outlet → 409 with that outlet's name (the FE shows the warn/confirm
  then the admin resolves by attaching or choosing another). On approve: writes `site.code`, sets manual
  recce `status=APPROVED + hoReviewStatus=APPROVED`; app recce behaviour unchanged.
- **`POST /v1/installation`** — body gains optional `recceId`; when present, install targets that recce;
  when absent, falls back to the outlet's single app recce (back-compat). 409 if the chosen recce isn't
  installable or already installed.
- **`GET /v1/installation/installable?siteId=…`** (VENDOR_FIELD) — lists the outlet's installable recces
  (APPROVED+HO-APPROVED, no install yet) with `recceMode` + element summary, for the field picker (R1).

---

## 7. Reporting (Wave B)

Today: one row per outlet (Element 1/2 columns). With 1 app + N manual recces, one outlet row can't hold
them all. Change the execution report to **one row per recce** (outlet columns repeat; element columns are
that recce's elements), and add a **"Recce Mode"** column = `App` / `Manual`. App-only tenants see no
behaviour change beyond the new column. **OWNER CONFIRM at B1 start:** row-per-recce vs. row-per-outlet
with manual recces appended as extra rows — functionally similar; confirm the exact column order and
whether app outlets with no manual recce should still show one row (yes).

Also: `analytics.service.ts` waterfall/counts must sum across all recces per outlet; digest counts
(`pendingHoReview`) must include manual recces now in the HO queue.

---

## 8. Wave A — capture + attach + HO + install re-key (orchestrated)

**Goal:** a manual recce can be submitted by the field exec, approved by HO with a mandatory Outlet ID,
and installed — end-to-end, locally runtime-proven. No report rework yet (the new column lands in B).

Orchestrator locks the §6 contracts, runs **A1 first** (schema + generate), then fans out A2–A6 against the
frozen contracts, then integrates + runs gates + runtime matrix.

| Lane | Scope | Key files |
|---|---|---|
| **A1** BE schema | `RecceMode`, migration + partial unique + backfill, `prisma generate`; decide `Site.provisional` | `schema.prisma`, `migrations/*_add_manual_recce` |
| **A2** BE manual submit | `POST /v1/recce/manual` (provision-or-attach, name-required, vendor derived, SUBMITTED+PENDING+MANUAL) + `GET /v1/sites/lookup` | `recce/`, `sites/` |
| **A3** BE HO + install re-key | widen HO queue (R4), manual approve sets status+hoReview APPROVED, mandatory+editable Outlet ID + exists-check (D6); install → recce-keyed (R1); exclude manual from ASM queue (R3) | `recce-ho-review/`, `installation/`, `approval/` |
| **A4** FE field manual recce | "Manual" entry; outlet form (one screen, no scroll) + Outlet-ID lookup/prefill/warn; reuse `PosmCaptureCard` (markup compulsory) | `platform/src/app/field/*`, `components/field/capture/*` |
| **A5** FE HO console | Outlet ID field (mandatory + editable + exists-warning) on recce-HO detail; manual recces in the queue with a Manual badge | `platform/src/app/admin/recce-ho-review/*` |
| **A6** FE field install | recce picker — list installable recces for an outlet, install against the chosen one (R1) | `platform/src/app/field/work/*` |

**Wave A Definition of Done**
- Full gates GREEN (api jest + build + typecheck; platform build + typecheck). `prisma generate` ran first.
- Runtime matrix (local, real login per role):
  - Field: submit manual recce (name-only) → appears in HO queue; submit with a NEW outletId; submit with
    an EXISTING outletId → warn + prefill + attaches (no dup outlet).
  - HO: approve manual **without** outletId → **400**; approve **with** outletId → installable; approve
    with a colliding outletId → **409 + existing outlet name**; reject with reason → back to field.
  - App recce path **unchanged** (ASM→HO→install still works; still capped at one app recce per outlet).
  - Field: install against a specific approved manual recce; a second manual recce on the same outlet is
    allowed and independently installable.
  - Scoping: another vendor's / another tenant's outlet invisible (404); ASM never sees manual recces.
- **Then:** push to staging (`develop`) for owner UAT before starting Wave B.

---

## 9. Wave B — report rework + audits + E2E (orchestrated)

| Lane | Scope |
|---|---|
| **B1** BE report + analytics | per-recce rows + "Recce Mode" column (§7); analytics multi-recce; digest `pendingHoReview` includes manual; update `outlet-execution.helper.spec` + `outlet-columns.test` |
| **B2** E2E (Playwright) | `manual-recce.spec.ts`: field manual submit → HO approve w/ Outlet ID → install → audit; + attach-to-existing case; + app-recce-still-unique guard. **Sweep every creation path for the new required/optional fields** (durable lesson — the RS/Beat-on-create miss). Parameterised local + staging. |
| **B3** Adversarial audit (fresh agent) | invariant: app still capped at 1 (partial index holds); manual unlimited; install can't target the wrong/foreign recce; Outlet ID uniqueness + attach correctness; manual recce cannot reach install without HO; cross-tenant/vendor isolation. **DUAL audit** (identity/outlet-key integrity). Concrete failure scenario per finding. |
| **B4** UI/UX audit (fresh agent) | one-screen no-scroll on real viewport; warn/confirm copy honesty ("already exists as <name>"); HO mandatory-field states + edit affordance; loading/empty/error states; Manual badge consistency; accessibility. |

**Wave B DoD:** gates GREEN; E2E GREEN locally + on staging; both audit lanes' real findings fixed;
report verified against a seeded mixed outlet (1 app + 2 manual recces); memory + this plan updated;
push to staging. **Prod is owner-gated and manual — not part of this plan.**

---

## 10. Durable lessons to honor (from memory)

- `prisma generate` **before** any gate after a schema change.
- A "required field on create" (here `outletName`, and the install `recceId` re-key) must sweep **every**
  creation path incl. Playwright specs (not just jest/tsc) — this bit us on RS/Beat.
- Gates don't boot the DI container / don't catch a new npm dep — restart the API to load new modules; use
  `node:crypto`, no new runtime imports absent from package.json.
- Staging deploy is `needs: test` → a RED suite silently SKIPS deploy. Run FULL suites; verify the serving
  Cloud Run image SHA after push.
- Paginated FE must load ALL pages; narrowest-correct change at the right altitude (partial index, not a
  code hack around uniqueness).

---

## 11. Open confirmations (non-blocking; resolve at lane start)

1. **B1 report layout:** row-per-recce column order + confirm app outlets with no manual recce still render
   one row (assumed yes).
2. **A1:** add `Site.provisional` flag vs. derive it (prefer derive).
3. **HO edit collision resolution UX:** when HO edits to a colliding Outlet ID, FE path = warn → (a) attach
   to existing or (b) pick another; confirm the exact control.
