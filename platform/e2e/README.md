# POSM E2E regression harness (Playwright)

Browser-driven go-live regression smoke for the POSM app. Runs against a **already-running** stack
(it does not start servers), so the same suite works against local dev and a deployed env.

## Run

```bash
# from platform/ — stack must be up (API + frontend + DB)
npm run e2e            # headless, all specs
npm run e2e:ui         # Playwright UI mode (watch/debug)
npm run e2e:report     # open the last HTML report
```

### Point it at an environment

| env var | default | meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | frontend base URL |
| `E2E_PASSWORD` | `Password123` | shared seed login password (local/staging only — never a prod secret) |
| `E2E_EMAIL_DOMAIN` | `kwality.in` | seed login email domain (`admin@<domain>`, …) |

```bash
E2E_BASE_URL=https://uat-posm.gifsy.in E2E_PASSWORD='<staging pw>' npm run e2e
```

## Browser

Uses the **system Chrome** (`channel: 'chrome'` in `playwright.config.ts`) to avoid depending on the
~195 MB bundled-Chromium download. To use bundled Chromium instead, run `npx playwright install chromium`
and drop `channel: 'chrome'` from the config.

## What it covers

- **auth** — each of the 5 seeded roles logs in and lands on its portal; wrong password rejected;
  unauthenticated visit redirects to login.
- **scoping** — cross-role route-gating (a role can't open another portal) — the security-critical checks.
- **admin** — masters overview counts; POSM Types list; create + deactivate a POSM type.
- **catalogue** — a field user sees the POSM catalogue (+ reachable from the bottom nav).
- **consoles** — ASM / auditor / vendor-HO / field portals render per role.
- **reports** — execution report grouped/frozen table renders; `.xlsx` export downloads.

## Notes / prerequisites

- Needs the **seeded roles** (`admin@`, `asm@`, `auditor@`, `fielda@`, `vendorho@` + the shared
  password) and the demo `STD` POSM type. Locally these come from `api/scripts/seed-verify.mjs`.
- **Serial by design** (`workers: 1`): specs share the tenant's seed data and a couple mutate it.
- The `create + deactivate POSM type` spec leaves a timestamped, **deactivated** `E2E-…` type each run
  (there is no hard-delete API; deactivated types are hidden from the field catalogue). Harmless.
- The full recce→approve→install→audit **capture pipeline** (native camera file input + geo-fenced
  submission) is a deeper follow-on; these specs verify the consoles load and are reachable per role.
