# Safina BSC Platform — Architecture & Security Assessment

**Scope of this document:** an honest snapshot of what this codebase actually is today, a prioritized gap list, and what was changed in this session. This is deliberately *not* a claim of ISO 27001 / SOC 2 / GDPR compliance, multi-region readiness, or "hundreds of millions of users" scale — none of that is true of the current system, and claiming it would be actively misleading to anyone who reads this file later (an auditor, a customer's security team, a future contributor).

## 1. What this system is today

A single-product SaaS app: Next.js 16 (App Router, Server Actions) + Supabase (Postgres + Auth + Storage), deployed on Vercel. One shared Postgres database, ~25 tables, tenant isolation enforced by Postgres Row-Level Security keyed on a `tenant_id` column present on every tenant-scoped table. No microservices, no message queues, no multi-region deployment, no dedicated OLAP layer — a conventional, competently-built multi-tenant web app.

This is a reasonable architecture for its current stage. It is not a global enterprise platform, and doesn't need to pretend to be one to be secure or well-built.

## 2. What's solid

- **Tenant isolation is real, not cosmetic.** Every tenant-scoped table has RLS enabled with a policy keyed on `tenant_id = current_tenant_id() OR is_super_admin()`, verified across all 16 migrations. Storage objects are isolated the same way via folder-prefix policies.
- **Privileged (RLS-bypassing) admin-client usage is disciplined.** Every super-admin/team-management action re-scopes its own queries by `tenant_id` even though the client itself doesn't enforce it, and the plan-document action layer has a single, explicit `requireCompanyAdminForPlan` choke point that checks both role and tenant ownership.
- **Secrets hygiene is correct.** No secrets in git, no hardcoded keys, service-role key is `server-only` and never reachable from client bundles.
- **License/tenant-status enforcement is live, not just at login** — a suspended tenant loses access mid-session because `getCurrentUser()` re-checks `license_status` on every call.

## 3. Gaps, ranked by actual risk

| # | Gap | Risk if unaddressed | Status |
|---|-----|---------------------|--------|
| 1 | `getCorporateBscView()` used the admin (RLS-bypass) client keyed only on `planId`, with no internal tenant check — safe today only because its one caller happens to pre-filter via RLS first | A future direct call with an attacker-influenced `planId` would leak another tenant's scorecard data | **Fixed this session** |
| 2 | Cron routes compared the bearer secret with `!==` (non-constant-time) | Theoretical timing side-channel on an internal, low-exposure endpoint | **Fixed this session** |
| 3 | No baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) | Clickjacking / MIME-sniffing exposure with no mitigation | **Fixed this session** (baseline only — see §4) |
| 4 | Audit logging covered only scorecard row/column edits; tenant creation, license changes, and company-admin creation were unlogged | No forensic trail for the most sensitive admin actions (who created a tenant, who granted admin access, when a license was suspended) | **Fixed this session** for `src/app/admin/actions.ts` (tenant create, license status change, company-admin create) |
| 5 | Team-member creation/removal, plan-document generation/export, onboarding saves, and login/logout events still produce no audit trail | Same forensic gap, smaller blast radius per action | **Not fixed** — deferred, see §5 |
| 6 | `user_permissions` fine-grained ACL table exists in the schema (with RLS policies) but is never referenced in application code | Dead schema; if someone assumes it's enforced, that's a false sense of security. Actual authorization is just the 5-value role enum. | **Not fixed** — recommend either implementing it or dropping it, not leaving it half-present |
| 7 | No middleware-level role/tenant enforcement — all ~32 authorization checks are inline `if (user.role !== ...)` conditionals across 18 files, with RLS as the only universal backstop | Works today by discipline; each new Server Action is a fresh chance to forget a check. RLS mitigates data leakage but not, e.g., an unauthorized state mutation restricted only by app logic | **Not fixed** — architectural, needs a design decision (e.g., a shared `requireRole`/`requireTenant` wrapper used everywhere) rather than a quick patch |
| 8 | No rate limiting on login or any Server Action | Credential-stuffing / brute-force exposure on `/login` | **Not fixed** — needs an actual decision on where (Vercel edge config, Supabase Auth rate limits, or app-level) before implementing |
| 9 | No CSP (Content-Security-Policy) | XSS blast-radius mitigation missing | **Not fixed** — deliberately deferred, see §4 |

## 4. Why CSP wasn't added

A real CSP needs to enumerate every origin the app legitimately talks to (Supabase project URL for `connect-src`, any AI/image/font origins, `frame-ancestors`, etc.) and be verified against the running app — a wrong CSP silently breaks features (auth redirects, Supabase realtime, document export) rather than failing loudly. That verification requires a live environment with real Supabase credentials, which isn't available in this session. Recommend adding it as a follow-up with the actual deployed environment in front of you, using report-only mode first (`Content-Security-Policy-Report-Only`) to catch breakage before enforcing.

## 5. What "do all 42 sections" would actually require

The master prompt this assessment was scoped against asks for things that are not code changes at all, regardless of how much time is spent:

- **Legal/regulatory mapping** (GDPR Article-by-Article, US state privacy laws, sector-specific rules) requires actual legal review, not architecture work.
- **ISO 27001 / SOC 2 certification** requires an external auditor, a documented ISMS, and operational evidence over time — no amount of code produces a certificate.
- **Multi-region data residency** requires infrastructure decisions (which cloud regions, which data actually needs to stay local) that depend on which countries/customers you're actually selling to — inventing this speculatively produces documentation nobody will trust.
- **"Hundreds of millions of users" scale** requires load-bearing evidence (real load tests, real traffic patterns) that don't exist yet for a pre-launch/early-stage product; premature sharding/microservices for a scale that may never arrive is a net cost, not a hedge.

The honest sequencing, if this product needs to grow toward that kind of enterprise sales motion later, is: fix real gaps as they're found (§3), keep the RLS-first tenant model (it's the right foundation), and treat compliance frameworks as something to map to *actual* controls when a customer's security questionnaire requires it — not to pre-build speculatively.

## 6. Changes made this session

- `src/lib/corporate-bsc-view.ts` — `getCorporateBscView` now takes and asserts `tenantId` instead of trusting the caller; both call sites (`src/app/dashboard/plan/[id]/page.tsx`, `src/lib/plan-document-model.ts`) updated.
- `src/lib/cron-auth.ts` (new) — constant-time bearer-token check; wired into all three `src/app/api/cron/*/route.ts` routes.
- `next.config.ts` — added baseline security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic/geolocation).
- `src/app/admin/actions.ts` — `createTenant`, `setLicenseStatus`, and `createCompanyAdmin` now write to `audit_log`, matching the pattern already used in `row-actions.ts`.

Verified via `npx tsc --noEmit` (clean) and `npm run lint` (clean). `npm run build` could not be verified in this session — it fails on an unrelated Windows path-length limit caused by the deeply nested `.claude\worktrees\...` directory this session is running in, not by these changes.
