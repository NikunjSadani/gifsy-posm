# Manual Recce — PROD Cutover Checklist

**Status:** READY — owner-gated. Nothing here runs automatically. Prod deploys are **manual**
(`workflow_dispatch` on `main` only).
**Prepared:** 2026-10-13.

## What this cutover ships
`main` (`ad79207`, the recce-HO-stage batch) → `develop` (`3634f1a`). **6 commits**, all the Manual
Recce work:
- `8fb4751` Wave A — field manual recce → HO → install (schema + migration `20261009163819_add_manual_recce`)
- `246137d` Wave B — per-recce report + "Recce Mode" column, analytics, E2E, dual audit
- `da57330` docs; `b52fba3` field-filter test robustness
- `7f6274d` HO attach-to-existing (dual-audited)
- `3634f1a` analytics tiles (Pending HO / App / Manual) + attach F5 fix

**DB change:** one migration, `20261009163819_add_manual_recce` — **additive & backward-compatible**:
new `RecceMode` enum, `recces.recceMode` column (`NOT NULL DEFAULT 'APP'` → existing rows grandfather
to APP), and the one-recce-per-site unique is **replaced** by a partial unique
`recces_app_one_per_site WHERE recceMode='APP'` (holds automatically — the old hard unique already
guaranteed ≤1 recce per site). **No data migration, no backfill script, no destructive change.**
**No new env vars / secrets / npm deps.** This exact migration already ran cleanly on staging.

---

## 1. Pre-flight (confirm before dispatching)
- [ ] **Staging is green on `3634f1a`** — all 3 Cloud Run services serve it @100% (the deploy that
      just went out). Owner has done UAT on staging and signed off.
- [ ] **CI `test` job is green** — the prod workflow is `needs: test`; a RED suite **silently skips**
      the deploy. (Our full suites pass locally: api 493 jest, platform 323 vitest + builds.)
- [ ] **GitHub Actions is not billing-blocked** — private repo → Actions minutes; a billing block
      silently skips the deploy. Confirm Actions can run (and an Actions spending limit is set, per
      the owner to-do).
- [ ] **Cloud SQL backup exists** — opshub-db has automated backups + PITR on. The migration is
      additive, so no restore is expected; this is belt-and-suspenders.
- [ ] `main` will **fast-forward** to `develop` cleanly (develop is 6 *linear* commits ahead → ff-only
      works; no merge commit, no conflicts).

## 2. Cutover
**Step A — fast-forward `main` to `develop`** (git only; does NOT trigger a deploy — prod is
`workflow_dispatch`-only, not on-push):
```bash
git fetch origin
git checkout main
git merge --ff-only origin/develop
git push origin main
```
*(Claude can run this on your explicit go — it's a git op, not the prod deploy. Per the working
agreement, merging to main needs your say-so.)*

**Step B — dispatch the prod deploy (OWNER, in GitHub):**
GitHub → **Actions** → **"Deploy - Production (main)"** → **Run workflow** → branch **`main`** → Run.
*(This is owner-only — it's the gated production deploy; Claude cannot and will not trigger it.)*

**What the workflow does** (no action needed — just watch): `test` → build **prod** images
(`posm-api:<sha>`, `posm-frontend:<sha>`) → run Cloud Run Job **`posm-migrate-prod` (`--wait`)** which
applies `add_manual_recce` to `posm_prod` **before** any traffic shift → deploy `posm-api-prod` +
`posm-frontend-prod` → `update-traffic --to-latest` → print serving SHA. If the migrate step fails,
traffic never shifts (old revision keeps serving) — safe-by-design.

## 3. Post-deploy verification ("pushed ≠ deployed" — Claude can run these, read-only)
```bash
# All serve the new SHA (= main HEAD) at 100% traffic, revision Ready:
for svc in posm-api-prod posm-frontend-prod; do
  gcloud run services describe "$svc" --project gifsy-posm --region asia-south1 \
    --format='value(status.latestReadyRevisionName, spec.template.spec.containers[0].image, status.traffic[0].percent)'
done
```
- [ ] Both services serve `posm-*:<main-sha>` @ **100%**, latest revision **Ready**.
- [ ] **Migration applied** — the deploy only shifts traffic after the `--wait` migrate job succeeds,
      so a 100% flip is proof `add_manual_recce` ran on `posm_prod`.
- [ ] **Smoke test** (prod): admin login returns 200; open `/admin/recce-ho-review` and `/admin/analytics`
      (the new "Pending HO approval" / "Recces via app|manual" tiles render). Optionally run one manual
      recce end-to-end if prod has a seeded field user + vendor + Element type.
- [ ] After the deploy, bind + watch the run with the PR/CI tools if desired; do **not** enable
      auto-merge or auto-anything.

## 4. Rollback (if something looks wrong)
The migration is **additive & backward-compatible** — the previous image ignores `recceMode` and the
new column/index — so a **code rollback needs no DB rollback**.
```bash
# Find the previous good revision, then route 100% back to it:
gcloud run revisions list --service posm-api-prod --project gifsy-posm --region asia-south1 --limit 5
gcloud run services update-traffic posm-api-prod --project gifsy-posm --region asia-south1 \
  --to-revisions <PREVIOUS_REVISION>=100
# repeat for posm-frontend-prod
```
Leave the `recces.recceMode` column + partial index in place (harmless to the old code). Only if a
true schema revert were ever needed would a down-migration be authored — not expected here.

## 5. Notes / gotchas (project-specific)
- Prod DB = `posm_prod` on the shared `opshub-db` (cross-project, project `opshub-506704`); the migrate
  job uses the elevated `posm_migrate_prod` user — same mechanism that applied this migration on staging.
- Prod MSG91 is **real** (email reports only; OTP removed). Manual recce sends no OTP/SMS → no impact.
- No prod config change is required for this feature.
- Prod has **no** `posm-frontend-e2e` service (e2e is staging-only) — the prod workflow deploys api + FE
  only.
- Per the standing agreement: Claude will not ff `main`, dispatch the deploy, or touch prod data without
  an explicit go for that specific action.
