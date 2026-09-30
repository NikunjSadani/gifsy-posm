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
