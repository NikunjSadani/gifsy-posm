# Auth rework — email + password (replace phone + OTP)

**Owner decisions (2026-10-01):** everyone logs in with **email + password**; **OTP fully removed**
(incl. schema); **admin-managed** passwords (no self-service reset); **bulk upload** gains email
(required) + optional initial password. Security-critical → **dual adversarial audit** at the end.

## Keep vs replace
- **KEEP (credential-agnostic):** the rolling session — `generateTokens`, `refreshToken` (rotation,
  reuse-detection, grace), `logout-all`, `invalidateAllSessions`, `assume-tenant`, the vendor-login
  gate, `jwt.strategy`. MSG91 service STAYS (email reports); only its login-OTP use goes.
- **REPLACE:** `sendOtp`/`verifyOtp` → `login(clientId, email, password)` → bcrypt verify →
  `generateTokens`. Login screen → email + password.
- **DELETE:** OTP endpoints + DTOs, `common/otp.ts`, `common/fixed-otp.ts`(+spec), `OtpCode` model +
  `OtpPurpose`/`OtpChannel` enums (destructive migration), MSG91 `sendOtp` usage, FE OTP/phone/consent UI,
  all FIXED_OTP/ALLOW_FIXED_OTP env + guards.

## Phases (gate each)
1. **Schema:** User += `email String?` (`@@unique([clientId,email])`), `passwordHash String?`,
   `failedLoginAttempts Int @default(0)`, `lockedUntil DateTime?`; `phone String` → `String?`
   (contact only; keep `@@unique([clientId,phone])`, nulls ok). DROP `OtpCode` + `OtpPurpose` +
   `OtpChannel`. Migrate (destructive) + `prisma generate`.
2. **Backend auth:** add `bcryptjs` (+types). `auth.service.login()` — find ACTIVE user by
   `(clientId, email)`, check `lockedUntil`, bcrypt compare, on fail increment+maybe-lock, on
   success reset counters + vendor gate + `generateTokens`. Controller: `POST /auth/login` (@Public),
   remove send-otp/verify-otp. Remove fixed-otp + otp helpers + MSG91.sendOtp. JwtPayload.phone→optional.
3. **Users admin:** create/update DTO += `email` (IsEmail; required on create), `password` (optional,
   MinLength 8 → hash); `phone` optional. Hash on write. P2002 now disambiguates phone|email|promoterCode.
   Login disabled when `passwordHash` null (→ clear error at login).
4. **Bulk upload:** headers → `email`(req), `password`(opt), `name`, `role`, `vendor_code`,
   `promoter_code`, `phone`(opt). Validate email (format+within-file+DB unique), hash password.
   Template endpoint + FE headers updated.
5. **Frontend:** rewrite `/auth/login` to email + password; `loginAction`→`POST /api/auth/login`;
   remove OTP verify screen/resend/consent. Admin user form += email + password(set/reset). Upload panel headers.
6. **Tests:** rewrite auth.service.spec (password), users specs (email/password), bulk spec; delete
   fixed-otp.spec + otp tests. Full gates.
7. **Deploy reconcile:** strip FIXED_OTP/ALLOW_FIXED_OTP + MSG91 OTP vars from .env.*.example,
   DEPLOY-CONTRACT, DEPLOY-ENV-VARS, docker-compose; keep MSG91 SMTP (reports). Note the auth change
   in DEPLOYMENT-PLAN.
8. **Seed + runtime-verify + DUAL audit:** seed dev users with emails + a known dev password; verify
   login per role end-to-end in the browser; independent dual adversarial audit of the auth path.

## Defaults (no ask): bcryptjs cost 10; min-8 password; lockout after 5 fails → 15 min; `(clientId,email)`
unique; phone optional; login error identical for unknown-email vs bad-password (no user enumeration).

## Status log
- 2026-10-01: spec locked, plan written. Starting Phase 1 (schema).
- 2026-10-01: **Phases 1–7 BUILT + gated.** Schema (email/passwordHash/lockout, phone optional, OtpCode
  + enums dropped — migration `20261001155748_auth_email_password_drop_otp`); bcryptjs login + lockout +
  uniform errors; OTP endpoints/DTOs/helpers (`common/otp.ts`, `common/fixed-otp.ts`, msg91.sendOtp) +
  FIXED_OTP throttler-skip removed; users create/edit/bulk gained email(req)+password(opt), phone
  optional, email/phone/promoter P2002 disambiguation; FE login → email+password, admin user form +
  columns, bulk headers, proxy public path → `/api/auth/login`; specs rewritten. Deploy scaffolding
  reconciled (FIXED_OTP/MSG91-OTP stripped from env templates + compose + DEPLOY-CONTRACT/ENV-VARS/
  ENVIRONMENTS; DEPLOY-RUNBOOK bannered). **Gates:** api tsc 0 + jest 372, FE tsc 0 + vitest 285.
  ▶ REMAINING: seed local users w/ emails+dev password + update `seed-verify.mjs`; runtime-verify login
  per role in the browser; DUAL adversarial audit of the auth path.
- 2026-10-01: **COMPLETE + runtime-verified + hardened.** Seeded local emails (admin@/asm@/auditor@/
  fielda@/fieldb@/vendorho@/bulkasm@ `@kwality.in`, password `Password123`) + updated seed-verify.mjs.
  Browser-verified: email+password login (admin → /admin); API 200+JWT; unknown-email == wrong-password
  401 (uniform); passwordHash never in the users payload; old send-otp = 404. Hardened: constant-time
  login via DUMMY_PASSWORD_HASH (anti-enumeration; residual ~40ms from the failed-attempt write is
  low-sev). Gates: api jest 374, FE vitest 285, both tsc 0. Commits `93acb6d` + `1f16ea0`.
  ▶ A formal INDEPENDENT dual-agent adversarial audit was not spawned (owner can request); the
  in-session adversarial checks (enumeration, hash-leak, lockout, proxy public-path) passed.
- 2026-10-01: **DUAL adversarial audit DONE + fixes landed** (`<this commit>`). Two independent
  auditors; I verified each + fixed the real ones. HIGH: password reset (single+bulk) now EVICTS
  sessions (runtime-proven); F8 closed on update()/deactivate() (un-assumed GIFSY_ADMIN can't write
  cross-tenant). MED: lockout no longer an enumeration oracle (locked → uniform 401, runtime-proven);
  atomic failed-attempt increment; bulk rejects GIFSY_ADMIN-email rows + maps P2002→409 + evicts on
  bulk reset; throttler skipIf fail-closed. LOW: bulk password read raw; TRUST_PROXY_HOPS env (real
  client IP for throttle). Auditors confirmed sound: no passwordHash leak, OTP removal complete,
  session machinery, tenant scoping, email normalization, proxy paths. +5 tests. Gates: api jest 379.
  Residual (accepted, LOW): ~40ms failed-attempt-write timing; lockout-DoS inherent to any lockout
  (auto-expires 15min + admin reset).
