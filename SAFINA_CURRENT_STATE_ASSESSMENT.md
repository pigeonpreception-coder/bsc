# Safina BSC Platform — Current-State Assessment, Gap Analysis & Target Architecture

**Baseline document, updated 2026-08-13 (tenth revision).** Originally derived from direct inspection of this repository as of 2026-08-12; revised ten times to reflect 31 commits made against its own findings (22 fixes plus these 10 revisions) (see §13 for the full list). Fixes 1–18 came from this document's own original gap analysis; fixes 19–20 from a second pass (§14); fix 21 from a third pass (§15, the confidentiality leak); fix 22 from a **fourth pass** (§16), which predicted its own outcome correctly: it found six more issues, including an open redirect on the auth domain and an SSRF hole reachable through the AI plan-generation feature — neither in a category any of the first three passes' scopes had even asked about. Four passes, four distinct new categories of finding. Treat that as the base rate for this codebase, not as evidence it's now exhausted. Everything below reflects the codebase's actual current state, re-verified against the same evidence standard as the original: source, migrations, config, and test output — not assumptions. Where something couldn't be verified from available evidence — including whether a manual configuration step the user still needs to perform (e.g. creating a Sentry account) has actually been done — that's stated explicitly. Nothing here is a compliance or certification claim; none exist. [SECURITY_ARCHITECTURE_ASSESSMENT.md](SECURITY_ARCHITECTURE_ASSESSMENT.md) is a point-in-time snapshot from earlier the same session and is **not** kept in sync with this document going forward — this file is the current source of truth.

---

## 1. Executive Summary

Safina is a **working, single-region, multi-tenant SaaS application** for Balanced Scorecard–based strategic management: an organization's admin sets up mission/vision/values, generates an AI-assisted strategic plan and a cascading Balanced Scorecard, staff update their KPI actuals, and the system computes RAG status, weighted performance scores, and exports the finished plan as Word/PDF. It is built on Next.js 16 (Server Actions, not a REST API) and Supabase (Postgres + Auth + Storage), deployed to Vercel with three scheduled cron jobs.

**What it solves today:** a small-to-mid-size organization can go from "we have no formal strategic plan" to a generated, editable, cascaded Balanced Scorecard with live KPI tracking and a board-ready exported document — without needing a consultant to build the template by hand. That core loop is real and functionally complete.

**What's changed since the original baseline:** four fresh gap-scan passes have now run (§14, §15, §16) and found and closed 19 issues between them — three cross-tenant write gaps, one cross-tenant document-confidentiality read, an open redirect on the auth callback route, an SSRF hole in the AI website-context feature, unenforced upload size/type limits, a decompression-bomb exposure in `.pptx` parsing, no rate limiting on password-reset requests, and several other silent-failure and defense-in-depth gaps; an automated test suite (104 tests) and a CI pipeline now exist; the "admin types your password" invite anti-pattern is gone, replaced with a real email-invite flow; login has rate limiting; the tenant-isolation gap in the corporate-BSC data helper is closed; audit logging now covers team invites, org-hierarchy saves, and document exports in addition to scorecard edits and tenant/license admin actions; cascade weighting is configurable via a settings screen instead of a silent hardcoded default; the duplicated `department` field across `org_positions` and `users` is consolidated to one source of truth; the unguarded org-hierarchy recursion that risked crashing the nightly performance-recalc job on corrupted data is fixed; the duplicated invite/account-creation logic is consolidated into one helper; the Super Admin tenant list is paginated instead of silently capped by PostgREST's default row limit; all three cron jobs process tenants with bounded concurrency instead of a fully serial loop; Sentry error monitoring is wired into the server, edge, and client runtimes plus a root-level error boundary; a notification system (header bell + email via Resend) now exists, distinct from the older page-scoped KPI alerts panel, and covers four events: position assignment, weekly-advisory generation, new-account welcome, and strategic-plan approval.

**One caveat on the Sentry item:** the monitoring code is complete and inert-safe (it does nothing until a DSN is configured), but it requires a manual step outside this repository — creating a Sentry project and setting `NEXT_PUBLIC_SENTRY_DSN` — that could not be verified from here. Whether it is actually receiving events in production is unconfirmed. Source-map upload (needed for readable, non-minified stack traces) was also deliberately not wired up — see §3.

**The same caveat applies to email notifications:** the code path is complete and inert-safe (no-ops until `RESEND_API_KEY` is set), but whether the account/API key is actually configured in production, and whether real emails are landing (not caught by spam filters, domain verified, etc.), is unverified from here.

**What still prevents it from being a production-grade enterprise platform:** no MFA, no user self-service (signup, profile editing), and no billing integration behind the "license" concept. These remain real gaps — none of the fixes above touched them.

**What prevents it from being a global platform:** no i18n/locale infrastructure, no multi-currency, no data-residency controls, single shared Postgres instance with no sharding/read-replica strategy, no multi-region deployment. None of this is implemented, and none of it needs to be yet — it isn't serving customers who require it.

### Maturity Scale Used in This Document

| Level | Name | Definition |
|---|---|---|
| 0 | Concept | Idea/spec only, no working code |
| 1 | Prototype | Runs, but incomplete/manual/throwaway |
| 2 | Functional MVP | Core workflow genuinely works end-to-end for real users; missing production hygiene |
| 3 | Production Application | Level 2 + tests, CI/CD, monitoring, security hardening appropriate to its actual risk |
| 4 | Enterprise Platform | Level 3 + SSO/MFA, fine-grained RBAC, SLAs, formal compliance program |
| 5 | Global Enterprise Platform | Level 4 + multi-region, data residency, localization, proven scale |

**Safina's rating: still Level 2 (Functional MVP), now closer still to Level 3.** All four of Level 3's requirements exist in code as of this revision — tests, CI/CD, monitoring, and meaningfully improved security hardening. **The rating isn't bumped to Level 3 yet for two reasons, both about verification, not missing code:** (1) monitoring is gated on `NEXT_PUBLIC_SENTRY_DSN`, a manual setup step outside this repository that could not be confirmed as done — code existing is not the same as a production incident actually being caught; and (2) "security hardening appropriate to its actual risk" is a judgment call, and MFA's absence is a reasonable objection for a product handling other companies' strategic and performance data, even though nothing in Level 3's definition strictly requires it. Once the Sentry DSN is confirmed live, Level 3 is a defensible claim.

---

## 2. What Has Been Built — Module Inventory

Legend: **Complete** (feature-complete for its scope) · **Functional** (works, real limitations) · **Partial** (exists but materially incomplete) · **Placeholder** (UI/schema exists, no real behavior) · **Missing** (does not exist)

### User & Organization Management

| Feature | Frontend | Backend | Database | Status |
|---|---|---|---|---|
| Login | ✅ | `src/app/login/actions.ts` | `public.users` | Functional, now rate-limited (`src/lib/rate-limit.ts`) |
| Forgot/reset password | ✅ | `src/app/auth/forgot-password/actions.ts` | Supabase Auth | Functional |
| Self-serve signup | — | — | — | **Missing** — every account is created by an admin (unchanged) |
| MFA | — | — | — | **Missing** — zero references anywhere in the codebase (unchanged) |
| User profile self-management | — | — | — | **Missing** — no route to edit own name/email; password only changes via forced reset link (unchanged) |
| User invitations | `AddTeamMemberForm.tsx`, `CreateCompanyAdminForm.tsx` | `src/lib/user-invite.ts` (`inviteUserAccount`), used by both `team/actions.ts` and `admin/actions.ts` | `public.users` | **Fixed — now Functional.** Real email-invite flow via `inviteUserByEmail`; the invitee sets their own password, the admin never sees or chooses it. The duplicate implementation across the two call sites is also consolidated into one shared, tested helper |
| Account activation/deactivation | — | — | — | **Missing** — no status/active column on `users` at all (unchanged) |
| Tenant creation | `NewTenantForm.tsx` | `admin/actions.ts` | `public.tenants` | Functional (super_admin only) |
| Departments/teams | — | `team/actions.ts` (`addTeamMember`, `assignPosition`), `team/page.tsx` | `org_positions.office_department_name` is now authoritative; `users.department` syncs from it | **Fixed — now Functional.** `org_positions` is the single source of truth whenever a position link exists; the Add Team Member dropdown is sourced from live org-chart data instead of a disconnected onboarding-questionnaire snapshot (a *third* copy of "department" found and fixed during this work, beyond the two originally flagged) |
| Positions & reporting lines | `OrgWizard.tsx` | `onboarding/actions.ts` | `org_positions.reports_to_id` (self-FK) | Functional. **Fixed** — hierarchy-depth traversal (`computePositionDepth()`, `src/lib/performance.ts`) now has a cycle guard; a corrupted `reports_to_id` chain stops the walk instead of crashing the nightly performance-recalc cron |
| Branches/business units | dashboard label only | — | — | **Missing** — "Branch/Department" is a UI label over the same `org_positions` unit, not a real structural concept (unchanged) |
| Subscription/licensing | `LicenseStatusForm.tsx` | `admin/actions.ts` | `tenants.license_tier/status` | **Placeholder** — manually-set admin dropdown, no billing/payment integration of any kind (unchanged) |
| Super Admin tenant list | `admin/page.tsx` | — | `public.tenants` | **Fixed.** Page-based pagination (25/page, exact count) — was previously unbounded and silently capped by PostgREST's default 1000-row limit with no indication anything was missing |

### Strategic Management & Balanced Scorecard

| Feature | Status | Evidence |
|---|---|---|
| Mission/vision/values | Complete | `questionnaire/actions.ts`; autosaved |
| Strategic themes (fixed at 4) | Functional | AI-generated via `src/lib/strategic-theme-generation.ts`, editable |
| Strategic objectives + theme alignment (many-to-many) | Functional | `strategic_objective_themes` junction table |
| Strategic initiatives as a real entity | **Placeholder** | No dedicated table — folded into a free-text `key_initiatives` column on scorecard rows; not trackable/assignable (unchanged) |
| Full BSC template (perspectives, KPIs, baselines, targets, actuals, weights) | Complete | 14/16-column GES template, `src/lib/scorecard.ts` |
| RAG auto-scoring | Complete | `computeAutoStatus`, deterministic thresholds (≥95% on-track / 80-94% at-risk / <80% off-track); now unit-tested |
| Cascading (corporate → dept → individual) | Functional | `calculatePerformanceScores()`, with the cascade rule itself extracted as a pure, tested `computeCompositeScore()`. **Fixed** — `cascade_weights` is no longer a silent hardcoded default; company_admins can tune it at `/dashboard/settings` |
| AI-generation | Functional | Real structured-output tool-calling against Claude (not free-text) generates scorecard rows, themes, and plan-document sections; old single-shot free-text flow was deliberately removed (`0016_drop_ai_generated_content.sql`) |

### Performance Management & Analytics

| Feature | Status | Evidence |
|---|---|---|
| Composite/weighted score calculation | Functional, now unit-tested | `src/lib/performance.ts` |
| Daily historical snapshot + 30-day trend chart | Functional | `saveDailySnapshot()`, one chart type (recharts line chart); the 30-day window is a real bound, not unbounded |
| Per-edit history log (`performance_snapshots`) | **Write-only** | Inserted on every actual-value edit; no report/UI ever reads it back (unchanged) |
| Formal review/approval of scores or ratings | **Missing** | Scores are purely computed from actual-vs-target; no manager sign-off step exists anywhere (unchanged) |
| Evidence/attachment on a KPI actual | **Missing** | No file/URL column on `scorecard_rows`; file upload exists only for the separate "business profile supporting documents" feature (unchanged) |
| Cross-department benchmarking / predictive analytics | **Missing** | "Weekly advisory" is an AI-generated text narrative comparing last week to this week — not a forecast or model (unchanged) |
| Alerts (KPI at-risk/off-track, task rollover) | Functional | Deduplicated, dashboard-panel only, `.limit(10)` — already bounded, not the pagination risk originally suspected |
| Alert type `overdue_task` | **Dead schema** | Allowed by the DB CHECK constraint and styled in the UI, but no code path ever inserts one (unchanged) |
| Daily AI-generated tasks | Functional | Self-rated completion (1-5), no manager sign-off, no manual task assignment exists at all (unchanged); tenant processing now bounded-concurrency instead of fully serial |

### Workflow, Documents, Notifications & Admin

| Feature | Status | Evidence |
|---|---|---|
| Manual task assignment (person→person) | **Missing** | Only insertion path into `daily_tasks` is the AI generator (unchanged) |
| In-app notifications (bell/notification center) | **Fixed — Functional.** | New `notifications` table + header bell (`NotificationBell.tsx`, visible on every dashboard page). Triggered on position assignment, weekly-advisory generation, new-account welcome, and plan approval; distinct from the older, page-scoped `performance_alerts` panel |
| Email notifications | **Fixed — Functional (unverified operational status).** | `src/lib/email.ts` sends via Resend, gated on `RESEND_API_KEY`; wired into 3 of the 4 in-app trigger points (not the welcome notification — Supabase's own invite email already covers that moment). Whether the API key is actually configured in production is unverified from here |
| SMS notifications | **Missing** | No SMS package in `package.json` (unchanged) |
| Reminders / SLA management / escalation | **Missing** | Zero matches for these concepts anywhere in `src/` (unchanged) |
| General approval workflow | **Single instance only** | `approveStrategicPlan()` — one status flip, the only approval action in the entire app (unchanged) |
| Document generation (Word + PDF) | Complete | `docx` package + Puppeteer/`@sparticuz/chromium`; stored in Supabase Storage, signed URLs (1hr TTL), keeps last 3 versions |
| Document templates | **Not user-configurable** | Single hardcoded template (`private-corporate-sme.ts`) (unchanged) |
| Admin: tenant creation, license status, company-admin creation | Functional and audit-logged | `admin/actions.ts` |
| Admin: tenant deletion | **Missing** | No delete action exists (unchanged) |
| Admin: data export on termination | **Missing** | No export mechanism exists (unchanged) |
| Tenant-level configuration UI | **Fixed — Functional (partial).** | `/dashboard/settings` now exists for cascade-weight tuning; no other tenant settings are exposed yet |

---

## 3. Current Architecture

**Frontend:** Next.js 16.2.10 App Router, React 19.2.4, Server Components + Server Actions (no separate REST API for app logic — only 4 `route.ts` handlers exist, 3 of which are cron endpoints). Tailwind CSS 4. Charts via `recharts`.

**Backend:** No separate backend service — all business logic lives in Server Actions co-located with the routes that use them. Authorization is still inline `if (user.role !== ...)` conditionals rather than a centralized policy layer — that architectural choice is unchanged, though the duplicated invite/account-creation logic within it is now consolidated (`src/lib/user-invite.ts`).

**Database:** Single shared Postgres instance (Supabase), 26 tables across 19 sequential migrations (`login_attempts` and `notifications` added, `user_permissions` dropped, this session), shared-schema multi-tenancy via `tenant_id` + Row-Level Security on every tenant-scoped table. Every FK and `tenant_id` column is indexed.

**Auth:** Supabase Auth, email/password only. Two client tiers: an RLS-scoped client for normal use, and a `server-only` service-role client (`src/lib/supabase/admin.ts`) that bypasses RLS. The one place that previously trusted a caller to have pre-scoped by tenant (`getCorporateBscView`) now asserts `tenantId` internally. Login now has Postgres-backed rate limiting (`src/lib/rate-limit.ts`) — 5 attempts/15min per email, 20/15min per IP.

**Storage:** One private Supabase Storage bucket (`company-documents`), tenant-isolated by folder-prefix RLS policy for direct client uploads. **Fixed** — the one server-side read path that used the RLS-bypassing admin client (`buildUploadedDocumentContext`, feeding AI document generation) didn't re-check that path against the caller's tenant; it now does (`isPathOwnedByTenant()`, §15). **Fixed** — the bucket itself had no `file_size_limit`/`allowed_mime_types` (migration `0020`), so the client-side 20MB/extension checks were the only enforcement; both are now set server-side, and the `.pptx` text extractor has a decompressed-size ceiling against a crafted zip-bomb upload (§16).

**AI:** Anthropic SDK (`claude-sonnet-5`), used with forced tool-calling (structured JSON output, not free text) for scorecard generation, theme generation, and document-section generation. Logged to an `ai_sessions` table.

**Infrastructure:** Vercel deployment, 3 scheduled cron jobs (`daily-tasks`, `performance-recalc`, `weekly-advisory`). **Fixed** — each now processes tenants with bounded concurrency (`src/lib/concurrency.ts`, a worker-pool capped at 5 concurrent tenants) instead of a fully serial loop; positions within a tenant still process sequentially by design, to keep total concurrent AI-API calls predictable. No region pinning, no CDN configuration beyond Vercel defaults, no containers/Kubernetes. `maxDuration` is still not set on the cron routes — the achievable value depends on the Vercel plan tier, which couldn't be determined from the repository.

**DevOps:** **Fixed** — a CI pipeline now exists (`.github/workflows/ci.yml`: typecheck + lint + tests on every PR and push to `main`), and an automated test suite exists (Vitest, 104 tests across 17 files covering the scoring/cascade engine, tenant isolation, cron auth, rate limiting, the shared invite helper, audit logging, plan-period math, storage-path/IP ownership guards, redirect-path validation, HTML-escaping, and the notification/email helpers). True RLS/Postgres integration testing remains out of scope — no Supabase CLI/Docker access in this environment to run a local Postgres instance against the real policies; what exists tests the application-layer logic that supplements RLS. Secrets via `process.env`, no secrets manager beyond Vercel's own env-var store.

**Integrations:** Anthropic (AI), Supabase (DB/Auth/Storage). **Fixed** — Sentry (`@sentry/nextjs`) is now wired for error monitoring: server/edge init and the `onRequestError` hook in `src/instrumentation.ts`, client init in `src/instrumentation-client.ts`, plus a root-level `global-error.tsx` boundary. Gated on `NEXT_PUBLIC_SENTRY_DSN` and inert without it — **whether it's actually configured and receiving events in production is unverified from this repository**. Source-map upload (`withSentryConfig` in `next.config.ts`, needed for readable production stack traces) was deliberately not added — it requires `SENTRY_AUTH_TOKEN` plus org/project config, and this environment's own `next build` already fails on an unrelated Windows path-length issue in the nested worktree directory, so a build-plugin change couldn't be verified safe against the Turbopack build. **Fixed** — Resend (`resend` package) is now wired for transactional email (`src/lib/email.ts`), gated on `RESEND_API_KEY` and inert without it, same operational-verification caveat as Sentry. Still no payment/billing provider, no SMS provider, no CRM/ERP/accounting integration, no identity provider (no SSO/SAML/OIDC beyond Supabase's own auth).

---

## 4. Multi-Tenancy Assessment

Real, not cosmetic: every tenant-scoped table has RLS enabled with a `tenant_id = current_tenant_id() OR is_super_admin()` policy. Storage follows the same pattern via folder-prefix policy. This is a **shared-database, shared-schema** model — one Postgres instance, tenant isolation entirely at the row level, no per-tenant schema/database, no tenant-selectable data residency.

**Can it scale to thousands of organizations?** Plausibly, for the database layer itself — Postgres with proper indexing handles millions of rows fine. **The cron scaling ceiling identified in the original baseline is improved, not eliminated.** All three scheduled jobs now process up to 5 tenants concurrently instead of one at a time, which meaningfully pushes out the point at which tenant count causes a function-timeout failure — but it doesn't remove the ceiling. A true fix (a real job queue, or per-tenant fan-out invocations) would require new infrastructure and was deliberately not built speculatively, consistent with this document's own recommendation not to over-build ahead of an actual scale signal.

**To millions of organizations:** would still require a fundamentally different tenancy/infrastructure model. Not a near-term concern given current usage.

---

## 5. Security Posture

| Control | Status |
|---|---|
| Tenant isolation (RLS) | **Implemented**, consistent across schema. Seven gaps found across four scan passes, all fixed — see §14/§15/§16 for the full list, spanning `getCorporateBscView` (pass 1) through `buildPlanDocumentModel`'s defense-in-depth hardening (pass 4). Each pass has found something the previous ones missed — treat "no known gaps" as current-evidence, not proof of absence |
| Open redirect | **Fixed** — `/auth/callback`'s `next` query param was concatenated into a redirect target unvalidated; a userinfo-splice payload (`next=@evil.com/...`) redirected off the real auth domain. Now validated as a same-origin relative path (§16) |
| SSRF | **Fixed** — the AI plan-generation feature's website-context fetch (`fetchWebsiteText`) had no scheme/host restriction and no response-size cap, reachable by any `company_admin` supplying a `website_url`. Now resolves and rejects private/loopback/link-local targets (including cloud metadata addresses) on every redirect hop, and caps response size while streaming (§16) |
| Secrets hygiene | **Implemented** — no hardcoded secrets, service-role key `server-only` |
| Audit logging | **Fixed — now broadly implemented.** Scorecard edits, tenant/license admin actions, team invites, org-hierarchy saves, document exports, and cascade-weight changes are all logged, and every insert now goes through `writeAuditLog()` (§14), which reports a failed write to Sentry instead of discarding it silently. Still not logged: individual task status changes, login/logout events |
| Rate limiting | **Fixed — Implemented for login and password reset.** Postgres-backed (no Redis/KV available in this deployment), 5/15min per email + 20/15min per IP, per action (§16 generalized the table to cover more than just login). Other Server Actions still have no rate limiting |
| Upload validation | **Fixed** — file-size/MIME-type limits were client-side only; the `company-documents` bucket now enforces both server-side, and the `.pptx` text extractor has a decompressed-size ceiling against a zip-bomb-style upload (§16) |
| MFA | **Missing** (unchanged) |
| CSP | **Missing** — baseline headers (frame-options, content-type-options, referrer-policy, permissions-policy) are implemented; CSP itself remains deliberately deferred pending a live environment to verify against without breaking auth/Supabase/document-export flows |
| Centralized authorization layer | **Missing** — inline checks only, RLS as backstop (unchanged) |
| Fine-grained ACL (`user_permissions` table) | **Resolved — removed.** Was dead schema (defined with RLS, never referenced by application code); dropped rather than implemented, since nothing needs per-resource sharing beyond the existing role-based access | 
| Automated security testing (SAST/DAST/dependency scanning) | **Missing** — CI now exists (typecheck/lint/test) but runs no security-specific scanning. Four consecutive manual gap-scan passes have each found something automated tooling might have caught faster — the strongest argument yet for this line item |
| ISO 27001 / SOC 2 / GDPR / other formal compliance | **Not applicable yet** — no evidence of, and no claim of, any formal compliance program |

---

## 6. Technical & Architectural Debt

| Problem | Status | Priority |
|---|---|---|
| `getDepth()`/hierarchy recursion had no cycle guard | **Fixed** — extracted as `computePositionDepth()`, walked iteratively with a visited set, unit-tested for the cyclic case | Was P2 |
| Duplicate account-creation logic (`addTeamMember` vs `createCompanyAdmin`) | **Fixed** — consolidated into `src/lib/user-invite.ts` (`inviteUserAccount`), tested including the rollback-on-failure path neither call site had a test for before | Was P2 |
| `department` duplicated as unlinked free text (and a *third* copy found: the questionnaire-sourced dropdown) | **Fixed** — `org_positions` is now the single source of truth, synced at both mutation points | Was P2 |
| No pagination on unbounded reads | **Fixed for the actual unbounded read** (Super Admin tenant list). The originally-named tables (`audit_log`, `performance_history`, `daily_tasks`) turned out on inspection to already be bounded by date filters/`.limit()`/being write-only — the original framing named the wrong tables | Was P2 |
| Cron jobs looped every tenant serially | **Improved, not eliminated** — bounded concurrency (5 at a time) via `mapWithConcurrency()`. A real fix still requires a job queue, deliberately not built without an actual scale signal | Was P2, now lower urgency |
| No automated tests | **Fixed** — 104 tests across 17 files, covering the scoring/cascade engine, tenant isolation, cron auth, rate limiting, invite rollback, notifications, email, audit logging, plan-period math, storage-path/IP ownership guards, redirect-path validation, HTML-escaping, and the concurrency helper | Was P1 |
| No CI/CD | **Fixed** — `.github/workflows/ci.yml` runs typecheck + lint + test on every PR and push to `main` | Was P1 |
| `user_permissions` table exists with RLS but is never used | **Fixed** — dropped (migration `0019_drop_user_permissions.sql`), per the user's decision that nothing needs per-resource ACLs beyond existing role-based access | Was P3 |
| `addScorecardColumn`/`updateCellValue`/`assignPosition` trusted caller-supplied foreign-key IDs without a tenant check | **Fixed** — see §5 and §14 | Was P1 |
| All 13 `audit_log` insert call sites discarded the result with no error check | **Fixed** — routed through `writeAuditLog()`, which reports failures to Sentry (§14) | Was P3 |
| N+1 dedup-check-then-insert loops inside `generatePerformanceAlerts` and `rolloverUnfinishedTasks` | **Fixed** — one dedup query + one bulk insert each, replacing per-row SELECT+INSERT (§14) | Was P3 |
| `saveOrgHierarchy` inserted one `org_positions` row at a time, recursively, in the request path | **Fixed** — level-by-level bulk insert with client-generated ids (§14) | Was P3 |
| `updateScorecardRow`'s `responsible_person` had no tenant/existence check | **Fixed** — tenant-scoped lookup added before the update (§14) | Was P3 |
| `approveStrategicPlan` notified every tenant member in a serial per-user loop | **Fixed** — batched via `mapWithConcurrency` (§14) | Was P3 |
| `computePeriodEnd` (pure date-math) had zero test coverage | **Fixed** — extracted to `src/lib/plan-period.ts`, tested (§14) | Was P4 |
| `buildUploadedDocumentContext` read caller-supplied storage paths via the RLS-bypassing admin client with no tenant-ownership check — cross-tenant document-content leak into AI generation | **Fixed** — `isPathOwnedByTenant()`, checked at both the write boundary (`saveBusinessProfileDraft`) and the read boundary (§15) | Was P1 |
| `addScorecardRow` trusted a caller-supplied `scorecardId` with no tenant check — same class as the pass-2 findings, missed then | **Fixed** — same pattern as the sibling actions (§15) | Was P1 |
| `generateCascadedBSCs`'s `scorecard_rows`/`position_scorecards` inserts were unchecked — a failure left an empty scorecard silently reported as success | **Fixed** — errors now thrown and caught by the existing per-position try/catch (§15) | Was P2 |
| Unchecked inserts/delete on the actual business-data writes in the nightly cron jobs (`daily_tasks`, `task_generation_log`, `weekly_advisories`, `performance_history`, `performance_scores` delete-before-insert) | **Fixed** — all now check their error (§15) | Was P3 |
| Per-tenant `count`-only query on the Super Admin page (N parallel queries, one per tenant on the page) | **Investigated, not changed** — already parallelized (not a blocking N+1), bounded to 25 by pagination, and low-traffic (super-admin only). A "proper" fix (grouped count via an RPC/view) would trade this deliberately-chosen exact-count pattern for one that risks silently undercounting past PostgREST's default row cap — not a good trade for a cosmetic gain on an internal page (§15) | P4, no action planned |
| `/auth/callback`'s `next` param was an open redirect (userinfo-splice, `next=@evil.com/...`) | **Fixed** — validated as a same-origin relative path (`isSafeRedirectPath()`), tested (§16) | Was P1 |
| `fetchWebsiteText` (AI plan-generation website context) had no SSRF protection — no scheme/host restriction, unbounded response buffering | **Fixed** — rejects private/loopback/link-local targets (incl. cloud metadata) on every redirect hop, streams with a byte cap instead of buffering the full response (§16) | Was P1 |
| Upload size/MIME limits were client-side only; `.pptx` extraction had no decompressed-size ceiling | **Fixed** — bucket-level `file_size_limit`/`allowed_mime_types` (migration `0020`), decompression cap in `extractPptx` (§16) | Was P2 |
| No rate limiting on password-reset requests | **Fixed** — `login_attempts` generalized with an `action` column; password reset now shares the same limiter as login, independently counted (§16) | Was P2 |
| `buildPlanDocumentModel` trusted an unscoped `planId` against the admin client — not currently exploitable (its one caller pre-checks), but the same "trust the caller" shape as four confirmed bugs across passes 2–3 | **Fixed** — internal `tenant_id` assertion added, matching `getCorporateBscView`'s pattern (§16) | Was P3 |
| `escapeHtml` (the boundary between AI-generated prose and the Puppeteer-rendered PDF) had zero test coverage | **Fixed** — tested, including script-tag and attribute-breakout injection attempts (§16) | Was P4 |
| `overdue_task` alert type allowed by schema/UI, never produced | **Not fixed** — dead code path, low impact | P4 |

---

## 7. Global Standards Alignment (Framework, Not Certification)

| Framework | Applicable? | Current Status | Gap | Priority |
|---|---|---|---|---|
| OWASP Top 10 | Yes | Improved — RLS mitigates broken access control; rate limiting now closes the credential-stuffing gap on login | No CSP, no automated scanning (SAST/DAST) | P1 |
| OWASP ASVS | Yes, as a target | Not assessed against formally | No SAST/DAST, no pen test | P2 |
| NIST CSF | Yes, as a target | Ad hoc | No formal risk register, no incident-response plan | P3 |
| ISO/IEC 27001 | Aspirational only | Not started | Requires an ISMS, external audit — organizational work, not code | Future |
| GDPR / regional privacy law | Applicable if/when EU or other regulated customers onboard | Not addressed | No data-subject request workflow, no documented lawful basis, no DPIA | High once relevant, not urgent pre-launch |
| Zero Trust (NIST SP 800-207) | Directionally relevant | RLS + role checks are a partial analog | No device/session risk signals, no continuous verification beyond session cookie validity | Future |

---

## 8. Product Maturity Scorecard (0–100)

| Domain | Score (was) | Basis for the change |
|---|---:|---|
| Functional Completeness | 64 (64) | No change |
| Architecture | 59 (58) | `buildPlanDocumentModel` now asserts tenant ownership internally instead of trusting its one (currently-correct) caller — defense in depth against a second caller forgetting the check |
| Security | 70 (65) | Two distinct new vulnerability classes closed in one pass, on top of everything already fixed: an **open redirect** on the auth domain itself (phishing primitive) and an **SSRF hole** reachable through the AI plan-generation feature (internal-network-probing primitive) — neither a tenant-isolation write bug like every finding in passes 2–3. Plus password-reset now rate-limited and upload size/type enforced server-side. Still missing MFA, centralized authz, SAST/DAST |
| Privacy | 28 (28) | No change — this pass's findings were security/availability-shaped (redirect, SSRF, resource limits), not confidentiality-shaped like pass 3's |
| Scalability | 46 (46) | No change |
| Performance | 40 (40) | No change — still no load-test evidence either way |
| Reliability | 50 (50) | No change — this pass's remaining findings were security-shaped, not reliability-shaped |
| Data Architecture | 70 (70) | No change |
| UX | 52 (52) | No change |
| DevSecOps | 40 (40) | No change in the score, but the case for it just got stronger: four consecutive manual passes have each found a new *category* of issue (tenant-isolation writes, a confidentiality read, then redirect/SSRF/resource-limit gaps) that automated tooling (dependency scanning, a redirect/SSRF linter rule, DAST) would very plausibly have caught faster and cheaper than a manual pass |
| Compliance | 10 (10) | No change |
| Globalization | 5 (5) | No change |
| AI Readiness | 60 (60) | No change |
| Enterprise Readiness | 37 (37) | No change |

**Overall maturity score: ~49/100, up from ~35/100 at the original baseline (~48 after the ninth revision).** Security absorbed essentially the entire movement again this revision — two new vulnerability classes in one pass is a larger jump than any single prior pass, including the confidentiality leak. Everything else held flat, the expected shape of a scan-and-fix pass rather than a feature pass.

---

## 9. Pending Decisions

Four of the six original items are resolved; the rest remain open.

| Functionality | Status | Recommended default (if still open) |
|---|---|---|
| User invitation flow | **Resolved** — implemented the recommended default (Supabase email-invite, admin never sets a password) | — |
| `cascade_weights` configurability | **Resolved** — implemented the recommended default (settings screen at `/dashboard/settings`) | — |
| Notification channel | **Resolved** — both in-app (header bell, `notifications` table) and email (Resend, gated on `RESEND_API_KEY`) are implemented | — |
| Billing/subscription model | **Still open** | Flat per-tenant subscription via Stripe Billing — simplest, matches the current tenant-level license model |
| Formal performance review workflow | **Still open** | Leave as auto-computed unless a specific customer/compliance need requires manager sign-off |
| Data residency requirements | **Still open, deliberately deferred** | Don't build speculative infrastructure until an actual deployment requires it |

---

## 10. Recommended Target Architecture (Directional, Not a Rebuild)

**Retain:** Next.js Server Actions model, Supabase Postgres + RLS-based tenant isolation, the AI tool-calling pattern for structured generation, the document-generation pipeline (docx/Puppeteer). These are sound choices for the current product, not technical debt.

**Completed this session, no longer open:** organization/department modeling, user invitation flow, automated test suite, CI/CD gate, pagination on the actually-unbounded read, rate limiting on `/login`, cascade-weight configurability, the duplicated invite logic, the unguarded hierarchy recursion, error monitoring (code-complete — see the verification caveat in §1 and §3), a notification system covering both in-app (header bell) and email (Resend) channels on four live trigger points (position assignment, weekly-advisory generation, new-account welcome, plan approval), and the `user_permissions` decision (dropped — see §6).

**Still to add:** source-map upload for readable production stack traces (needs `SENTRY_AUTH_TOKEN`, deliberately deferred — see §3); a real job queue if/when tenant count outgrows bounded concurrency; more notification trigger points as concrete needs arise (e.g. team invites, plan approval).

**Defer until an actual need exists:** multi-region deployment, data residency controls, i18n/localization, formal ISO/SOC2 program, microservices decomposition, SAST/DAST scanning (valuable, but proportionate to add once there's a security review process to act on its findings, not before).

---

## 11. Priority Roadmap

**P0 — Critical (do before any external/production launch):** ~~rate limiting on login~~ done · ~~replace the password-sharing invite pattern~~ done · ~~audit-log the remaining sensitive actions~~ done for team creation/document export/onboarding saves.

**P1 — Very High:** ~~automated tests~~ done · ~~CI pipeline~~ done · ~~basic error monitoring~~ code-complete, **pending your one-time setup step** (create a Sentry project, set `NEXT_PUBLIC_SENTRY_DSN`) before it's actually catching anything.

**P2 — High:** ~~unguarded hierarchy recursion~~ done · ~~consolidate duplicated account-creation logic~~ done · ~~pagination~~ done (for the table that actually needed it) · ~~bound cron concurrency~~ done · ~~`cascade_weights` settings UI~~ done.

**P3 — Medium:** ~~decide on `user_permissions`~~ done (dropped) · ~~notification system (in-app + email)~~ done · formal risk register and incident-response plan.

**P4 — Future:** billing integration; i18n/localization; data residency; multi-region deployment; formal compliance program (only once a specific customer or legal requirement names it).

---

## 12. Next Development Instructions Required From the Client

Everything from the original list is done, error monitoring is code-complete, the notification system (in-app + email) is built, `user_permissions` is resolved (dropped), and the full §14 gap-scan backlog is cleared. What's left is entirely things this document can't do on its own — a verification step outside the repo, or a business decision:

1. **"Verify Sentry is actually receiving events, then add source-map upload."** — not a development task so much as a verification one: create the Sentry project, set `NEXT_PUBLIC_SENTRY_DSN`, hit `/api/sentry-check` once to confirm an event lands, then decide whether to wire up `withSentryConfig` (needs `SENTRY_AUTH_TOKEN`) for readable production stack traces.
2. **"Verify Resend is actually sending, and that emails land (not spam)."** — same category as the Sentry item: create the Resend project, set `RESEND_API_KEY`, and once volume justifies it, verify a sending domain (`NOTIFICATION_EMAIL_FROM`) instead of the shared `resend.dev` testing address.
3. **"Add a real job queue for the cron routes"** — only once tenant/position counts actually approach what bounded concurrency can't handle; don't build this speculatively.
4. **"Decide on a billing provider and wire it behind the existing `license_tier`/`license_status` fields."** — needed before any real commercial launch, but is a business decision, not something to build ahead of that decision.

Notification trigger points now cover four events (position assignment, weekly-advisory generation, new-account welcome, plan approval). Further ones (e.g. task overdue, KPI status change surfaced through the same channel as `performance_alerts`) remain additive, whenever a concrete need shows up. There is no third gap-scan backlog waiting behind this one — the next fresh pass, whenever it happens, starts from a clean list.

Items intentionally **not** included: multi-region infrastructure, formal compliance certification, i18n, SAST/DAST scanning — each requires a business decision or an actual customer/regulatory trigger before it's worth building.

---

## 13. Changelog

Fixes made against this document's own findings, in the order they were built (all on `main`):

1. Hardened tenant isolation (`getCorporateBscView`), cron auth (constant-time comparison), baseline security headers, extended admin audit logging
2. Added evidence-based current-state assessment (this document, original version)
3. Added automated test suite and CI pipeline
4. Replaced admin-set-password account creation with email invites
5. Extended audit logging to team invites, org saves, and document export
6. Added rate limiting to login
7. Added a cascade weighting settings screen for company admins
8. Synced `users.department` from `org_positions` instead of duplicating it
9. Sourced the department picklist from `org_positions`, not the questionnaire
10. Fixed unguarded hierarchy recursion in the performance cascade engine
11. Consolidated duplicate invite-account logic into a shared helper
12. Paginated the Super Admin tenant list
13. Bounded the cron routes' tenant processing to a fixed concurrency
14. First revision of this document — reflected fixes 1–13
15. Added Sentry-based error monitoring (server, edge, client, root error boundary) — code-complete, pending the user's one-time Sentry project setup
16. Second revision of this document — reflected fix 15
17. Added an in-app notification system: `notifications` table, `createNotification()` helper, header bell (`NotificationBell.tsx`, visible app-wide), wired into position assignment and weekly-advisory generation
18. Third revision of this document — reflected fix 17
19. Added email notifications: `src/lib/email.ts` (Resend, gated on `RESEND_API_KEY`), extended `createNotification()` with an optional `email` param, wired into the same two trigger points as the in-app channel
20. Fourth revision of this document — reflected fix 19
21. Dropped `user_permissions` (migration `0019_drop_user_permissions.sql`) — per the user's decision that nothing needs per-resource ACLs beyond existing role-based access
22. Fifth revision of this document — reflected fix 21
23. Added two more notification trigger points: a welcome notification on account creation (`user-invite.ts`, in-app only — Supabase's own invite email already covers that moment) and a plan-approval notification to every other tenant member (in-app + email, `plan/[id]/actions.ts`)
24. Sixth revision of this document — reflected fix 23
25. Ran a fresh gap-scan pass (§14) and fixed the two highest-impact findings: `addScorecardColumn`/`updateCellValue` (`column-actions.ts`) and `assignPosition` (`team/actions.ts`) now verify caller-supplied foreign-key IDs belong to the caller's tenant before writing, closing two cross-tenant write gaps RLS's insert-check alone didn't catch
26. Seventh revision of this document — reflected fix 25
27. Cleared the rest of the §14 backlog on explicit instruction ("fix them all at once"): added `writeAuditLog()` (`src/lib/audit-log.ts`) and routed all 13 audit_log insert call sites through it, reporting failures to Sentry instead of discarding them; batched `approveStrategicPlan`'s per-user notification loop with `mapWithConcurrency`; added a tenant-scoped existence check to `updateScorecardRow`'s `responsible_person` field; extracted `computePeriodEnd` into `src/lib/plan-period.ts` (a `"use server"` file's exports must all be async, so a sync pure function can't live there and still be testable) and added coverage; batched the dedup-check-then-insert loops in `generatePerformanceAlerts` and `rolloverUnfinishedTasks` into one dedup query plus one bulk insert each; and converted `saveOrgHierarchy`'s recursive one-row-at-a-time inserts into level-by-level bulk inserts (client-generated UUIDs so children know their parent's id without a round trip first)
28. Eighth revision of this document — reflected fix 27
29. Ran a third gap-scan pass (§15) and fixed all 5 findings worth fixing (a 6th was investigated and deliberately left as is): closed a genuine cross-tenant document-confidentiality leak in `buildUploadedDocumentContext` (`isPathOwnedByTenant()`, checked at both the storage-path write boundary and the read boundary); added the same tenant-ownership check to `addScorecardRow` that pass 2 added to its siblings but missed here; surfaced previously-unchecked `scorecard_rows`/`position_scorecards` insert errors in AI cascade generation so a failure is no longer reported as silent success; and added error checks to the remaining unchecked cron-job writes (`daily_tasks`, `weekly_advisories`, `performance_history`, the `performance_scores` delete-before-insert)
30. Ninth revision of this document — reflected fix 29
31. Ran a fourth gap-scan pass (§16) and fixed all 6 findings: closed an open redirect on `/auth/callback` (`isSafeRedirectPath()`) and an SSRF hole in the AI plan-generation website-context fetch (`fetchWebsiteText`, now resolves and rejects private/reserved IPs on every redirect hop with a streamed byte cap instead of unbounded buffering); enforced upload size/MIME limits server-side on the `company-documents` bucket and added a decompression-size guard to `.pptx` extraction; generalized the login rate limiter to also cover password-reset requests; hardened `buildPlanDocumentModel` with an internal tenant assertion; and added test coverage for `escapeHtml`, the boundary between AI-generated content and the Puppeteer-rendered PDF
32. This update — tenth revision, reflecting fix 31

---

## 14. Fresh Gap-Scan Pass (Second Pass, Post Original Punch List)

Run after every item in the original §5/§6/§9 gap list was resolved, specifically to check whether "the known list is done" quietly became "there's nothing left" — it hadn't. An agent was pointed at the codebase with this document as context (so it wouldn't re-flag anything already listed) and asked to find genuinely new issues across five categories: missing authorization checks, missing input validation, N+1 query patterns, silently-swallowed errors, and untested pure logic. It returned 8 findings. The two most severe (real cross-tenant write gaps) were fixed immediately; the other six were initially recorded rather than built unprompted, since none were individually urgent enough to justify building ahead of a specific instruction. The user then explicitly asked for the rest of the backlog to be cleared in one pass, and it was — **all 8 findings are now fixed.**

| Finding | Fix |
|---|---|
| `addScorecardColumn`/`updateCellValue` never verified `scorecardId`/`rowId`/`columnId` belonged to the caller's tenant before writing. RLS's insert `with check` only validates the *new row's own* `tenant_id`, not that a caller-supplied foreign-key ID points at something in that tenant — a `company_admin` could plant a column, or upsert a cell value, against another tenant's scorecard. `scorecard_cell_values` has a *global* `unique (row_id, column_id)` constraint (not per-tenant), so a forged upsert could also permanently block the real owner's later edits to that cell. | Both actions now look up the referenced row(s) scoped to `tenant_id` first and fail closed if not found — the same pattern the sibling `deleteScorecardColumn`/`renameScorecardColumn` already used. |
| `assignPosition` never verified `targetUserId` belonged to the caller's tenant before using it with the RLS-bypassing admin client. A `company_admin` could link a position — and its assignment email — to a user account in an entirely different tenant. | Looks up the target user scoped to `tenant_id` up front; fails closed if not found. |
| All 13 `audit_log` insert call sites discarded the result with no error check — a failed audit write was invisible, with no console/Sentry signal. | New `writeAuditLog()` helper (`src/lib/audit-log.ts`); every call site now routes through it, reporting failures to Sentry (`captureException`) instead of silently discarding them. Tested (`audit-log.test.ts`). |
| `generatePerformanceAlerts` (`performance.ts`) and `rolloverUnfinishedTasks` (`tasks.ts`) each did one dedup `SELECT COUNT` + conditional `INSERT` per row, sequentially, inside the nightly cron jobs. | Both now fetch every existing matching alert in one query, dedup in memory against the candidate set, and bulk-insert the new ones in a single call — up to 2N round trips collapsed to 2 (`rolloverUnfinishedTasks`'s per-task `daily_tasks` update stays per-row, since `task_date`/`rollover_count` genuinely differ per row; only the alert dedup-then-insert pattern was the N+1). |
| `saveOrgHierarchy` (`onboarding/actions.ts`) inserted one `org_positions` row at a time, recursively, synchronously in the request the company_admin is waiting on. | Rewritten as a level-by-level (BFS) bulk insert: each node's id is generated client-side (`crypto.randomUUID()`) before insertion, so a whole level's rows — which only need their *parent's* id, already known — go in one `insert()` call instead of one round trip per node. `sort_order` is computed in a separate pre-order pass first, so display ordering is unchanged even though insertion order is now BFS. N sequential round trips → depth(tree) round trips. |
| `updateScorecardRow`'s `responsible_person` field was written with no check that the value was a real user in the tenant. | Added a tenant-scoped lookup before the update; throws if the id doesn't resolve to a user in the same tenant. |
| `approveStrategicPlan` notified every tenant member in a serial per-user loop, each iteration doing one DB insert plus (when email is set) one blocking Resend HTTP call — a gap this session's own plan-approval notification work introduced (see fix 23), not a pre-existing one. | Now uses `mapWithConcurrency` (the same worker-pool helper the cron routes use), capped at 5 concurrent, instead of a fully serial loop. |
| `computePeriodEnd` (previously private to `questionnaire/actions.ts`) was a pure date-math function with zero test coverage. | Extracted to `src/lib/plan-period.ts` — it couldn't just be exported in place, since a `"use server"` file's exports must all be async Server Actions and this is a sync helper — and given a real test file (`plan-period.test.ts`), including a leap-year edge case. |

No open items remain from this pass.

---

## 15. Third Gap-Scan Pass

Run on explicit request, after §14's backlog was fully cleared. Same method as pass 2 — an agent pointed at the codebase with this document as context, explicitly told not to re-flag anything in §5/§6/§9/§14, asked to look across five categories (authorization, input validation, N+1 patterns, swallowed errors, test coverage) plus a sixth: any other cross-tenant leak or write-without-ownership-check pattern not fitting neatly into the first five. It returned 5 findings. All were verified by direct inspection before fixing (not just trusted from the scan) — including confirming the exploit chain for the confidentiality finding by tracing it from the Server Action that persists the path through to the AI-generation call that reads it.

| Finding | Fix |
|---|---|
| `buildUploadedDocumentContext` (`document-extract.ts`) downloaded caller-supplied storage paths (`company_profile_url`, `strategic_plan_document_url`, each supporting document's `url`) via the RLS-bypassing admin client, with no check the path belonged to the caller's tenant. Legitimate uploads can only land under the uploader's own tenant folder (Storage RLS), but `saveBusinessProfileDraft` persisted whatever path string the client sent with no re-validation — so a `company_admin` who supplied another tenant's storage path had that tenant's document content extracted and woven into their own AI-generated Strategic Plan. This is the most severe finding across all three passes: a genuine cross-tenant **confidentiality leak**, not an integrity/availability gap like every prior finding. | New `isPathOwnedByTenant()` (`document-extract.ts`), checked in two places: at the write boundary (`saveBusinessProfileDraft` now rejects any path not under the caller's own tenant folder before saving) and again at the read boundary (`buildUploadedDocumentContext` itself, as defense in depth for any other code path that might reach it without going through that write boundary first). Tested (`document-extract.test.ts`), including a prefix-collision case (`tenant-1` vs `tenant-10`). |
| `addScorecardRow` (`row-actions.ts`) never verified `scorecardId` belonged to the caller's tenant before inserting — the same bug class pass 2 fixed in `addScorecardColumn`/`updateCellValue`/`assignPosition`, just missed in this one sibling action. | Same fix pattern as its siblings: looks up the scorecard scoped to `tenant_id` first, fails closed if not found. |
| Inside AI cascade generation (`generateCascadedBSCs`), the `scorecards` insert checked its error correctly, but the immediately-following `scorecard_rows` and `position_scorecards` inserts (in all three of the staff/office/individual code paths) didn't. A failure there left an empty scorecard shell while the surrounding try/catch never saw it, so `onboarding_completed` was set `true` and the AI-session log reported full success. | All six insert calls (two per code path × three paths) now check their error and throw, which the existing per-position try/catch already catches and records in `failures`. |
| Several business-data writes in the nightly cron jobs were unchecked: `daily_tasks` insert, `task_generation_log` insert, and `weekly_advisories` insert (`tasks.ts`); `performance_history` insert and the `performance_scores` delete-before-insert (`performance.ts`). The delete-before-insert case was the sharper one — a silently failed delete followed by a successful insert would leave duplicate `performance_scores` rows per position, breaking every `.maybeSingle()` lookup against that table from then on. | All five now check their error and throw; each call site is already inside a per-tenant try/catch in the corresponding cron route, so this doesn't change failure-isolation behavior, only whether a failure is visible at all. |
| Super Admin tenant list (`admin/page.tsx`) issues one `count`-only query per tenant on the current page. | **Investigated, left as is.** It's already parallelized (`Promise.all`), not a blocking N+1 in the sense every other finding this session was; it's bounded to 25 by the pagination already in place (§14); and it's a low-traffic, super-admin-only page. A "proper" fix (a grouped count via a Postgres RPC or view) would trade this deliberately-chosen exact-count pattern — written specifically to avoid PostgREST's default row-cap silently undercounting — for one that reintroduces that exact risk. Not a good trade for a cosmetic gain on an internal page; recorded in §6 rather than built. |

**The pattern across three passes is the finding itself:** pass 1 found one tenant-isolation gap; pass 2, run specifically to check whether more existed, found three more of the same class plus five other issues; pass 3, run again specifically to check the same question, found a fourth instance of the write-path class *and* an entirely new confidentiality-leak class neither prior pass's categories were framed to catch. Nothing about this codebase's architecture prevents a fourth pass from finding a ninth kind of issue. Treat the absence of a currently-known gap as "not yet found," not "doesn't exist."

---

## 16. Fourth Gap-Scan Pass

Run on explicit request, after §15's findings were fully closed. Same method, extended: the agent was told not to re-flag anything in §5/§6/§9/§14/§15 and pointed at five specific new angles — file-upload path traversal, prompt-injection risk from AI-fed uploaded/website content, rate limiting beyond login, an exhaustive sweep of every `createAdminClient()` call site for unscoped queries, and remaining test-coverage gaps. It returned 6 findings plus two explicit non-issue verdicts (both independently checked before accepting): file-upload path traversal is blocked by Storage RLS and non-POSIX path handling, and prompt injection's blast radius is already capped by forced tool-calling schemas plus the HTML-escaping this pass then added test coverage for. All 6 findings were fixed; none were deferred.

| Finding | Fix |
|---|---|
| `/auth/callback` (`route.ts`) built its post-login redirect as `` `${origin}${next}` `` with `next` read straight from the query string and never validated. A payload like `next=@evil.com/phish` parses in every browser as host `evil.com` (userinfo splice) — an open redirect served from the real auth domain, the strongest possible pretext for a phishing link. This is the most severe finding of this pass: unlike every prior finding (all cross-tenant *data* bugs), this is a bug that can be weaponized against a human, not just against the data model. | New `isSafeRedirectPath()` requires a single leading `/` with no second `/` or `\` immediately after (blocks the userinfo-splice payload, `//evil.com`, and the `/\evil.com` browser-parsing variant of the same bypass); anything that fails it falls back to `/`. Tested (`route.test.ts`), including each bypass variant individually. |
| `fetchWebsiteText` (`document-extract.ts`), used for AI plan-generation website context, fetched a tenant-supplied `website_url` with no scheme/host restriction and no response-size cap — buffering the entire response via `.text()` before an 8000-char truncation, bounded only by an 8-second timeout. A `company_admin` (a role, not a privilege escalation) could point this at internal infrastructure, including cloud metadata endpoints. | New `isPrivateOrReservedIp()` (RFC1918/loopback/link-local/CGNAT/reserved ranges, both IPv4 and IPv6) checked against the DNS-resolved address of the target *and every redirect hop* (a naive single-hop check would leave a same-origin-looking URL that redirects to an internal address) via a hand-rolled bounded redirect loop (`safeFetch()`, max 3 hops) — `fetch`'s own automatic redirect-following only validates the first hop. Response body is now read via a streaming reader with a 2MB hard byte cap instead of `.text()`. Tested (`document-extract.test.ts`). |
| Upload size (20MB) and file-type restrictions (`FileUploadField.tsx`) were enforced client-side only — the `company-documents` Storage bucket itself had no `file_size_limit`/`allowed_mime_types` set, so a direct API call could bypass both entirely. Compounding this, `.pptx` extraction (`extractPptx`) decompressed every slide fully into memory via JSZip with no size ceiling of its own — a decompression-bomb-style upload could force excessive memory/CPU during the Strategic-Plan-generation request path. | Migration `0020` sets `file_size_limit`/`allowed_mime_types` on the bucket itself (matching the client's own limits). `extractPptx` now tracks cumulative decompressed length across slides and stops once it exceeds 2M characters — bounding the "many bloated slides" case; a single pathologically-compressed slide is still only bounded by the process's own memory, same residual risk as any other decompression call in this codebase, caught by the existing outer try/catch rather than crashing. |
| `requestPasswordReset` had no rate limiting at all — unlike login, nothing throttled repeated password-reset requests for the same email, enabling inbox-flooding. | `login_attempts` generalized with an `action` column (migration `0021`); `rate-limit.ts` now exposes `checkRateLimit`/`recordAttempt` parameterized by action, with `checkLoginRateLimit`/`recordLoginAttempt` and the new `checkPasswordResetRateLimit`/`recordPasswordResetAttempt` as thin wrappers. Same thresholds as login (5/15min per email, 20/15min per IP), counted independently per action. |
| `buildPlanDocumentModel` (`plan-document-model.ts`) fetched a `strategic_plans` row by `planId` alone via the admin client, with no internal tenant check — relying entirely on its one caller (`downloadStrategicPlan`) having already verified ownership. Not currently exploitable, but structurally identical to the "trust the caller" shape that produced four confirmed cross-tenant bugs across passes 2–3; a future second caller that forgets the upstream check would silently reopen a cross-tenant document read. | Now takes `tenantId` as a required second parameter and filters on it directly, matching `getCorporateBscView`'s already-established pattern. |
| `escapeHtml` (`plan-document-html.ts`) — the sole boundary between AI-generated (and therefore attacker-influenceable, via a prompt-injected uploaded document) prose and the Puppeteer-rendered PDF — had zero test coverage. A future edit that narrowed the escaping would reopen an HTML/script-injection path with nothing to catch it. | Exported and tested (`plan-document-html.test.ts`), including a script-tag injection attempt and an attribute-breakout attempt. |

**Checked and confirmed as non-issues** (not fixed, because there was nothing to fix):
- **File-upload path traversal.** A crafted filename containing `/` or `..` can't escape the uploader's own tenant folder — Storage RLS checks `(storage.foldername(name))[1] = current_tenant_id()`, and Supabase Storage treats the object name as an opaque path string with no POSIX-style `..` collapsing.
- **Prompt injection.** Uploaded-document and website text does reach AI prompts as attacker-influenceable input, but every generation call uses forced tool-calling against a fixed schema (`submit_plan_sections`, `submit_scorecard`, `submit_tasks`) validated against known section numbers, so injection can't escalate to arbitrary tool calls or reach another tenant's data — and whatever prose does come back is HTML-escaped (the finding directly above) before reaching the Puppeteer-rendered PDF, closing the one path that would have turned it into script execution. Net effect of a successful injection is misleading text in that tenant's own generated plan, not a security-boundary crossing.

**Four passes, four different categories of finding**, in order: a single tenant-isolation gap (pass 1); more of the same class plus efficiency/error-handling issues (pass 2); a confidentiality *read* leak, a different shape than every write-path finding before it (pass 3); an open redirect and an SSRF hole, neither a tenant-isolation bug of any kind (pass 4). Each pass's scope was written specifically to catch what the previous passes might have missed, and each one still found something outside its predecessors' framing. That is the strongest evidence in this document that a fifth pass would find a fifth category, not that the codebase has run out of categories.
