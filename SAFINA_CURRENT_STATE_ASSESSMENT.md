# Safina BSC Platform — Current-State Assessment, Gap Analysis & Target Architecture

**Baseline document, updated 2026-08-12.** Originally derived from direct inspection of this repository as of 2026-08-12; updated the same day to reflect 16 commits of fixes made against its own findings (see §13 for the full list). Everything below reflects the codebase's actual current state, re-verified against the same evidence standard as the original: source, migrations, config, and test output — not assumptions. Where something couldn't be verified from available evidence (load behavior, real-world usage, UX quality under actual use), that's stated explicitly. Nothing here is a compliance or certification claim; none exist. [SECURITY_ARCHITECTURE_ASSESSMENT.md](SECURITY_ARCHITECTURE_ASSESSMENT.md) is a point-in-time snapshot from earlier the same session and is **not** kept in sync with this document going forward — this file is the current source of truth.

---

## 1. Executive Summary

Safina is a **working, single-region, multi-tenant SaaS application** for Balanced Scorecard–based strategic management: an organization's admin sets up mission/vision/values, generates an AI-assisted strategic plan and a cascading Balanced Scorecard, staff update their KPI actuals, and the system computes RAG status, weighted performance scores, and exports the finished plan as Word/PDF. It is built on Next.js 16 (Server Actions, not a REST API) and Supabase (Postgres + Auth + Storage), deployed to Vercel with three scheduled cron jobs.

**What it solves today:** a small-to-mid-size organization can go from "we have no formal strategic plan" to a generated, editable, cascaded Balanced Scorecard with live KPI tracking and a board-ready exported document — without needing a consultant to build the template by hand. That core loop is real and functionally complete.

**What's changed since the original baseline:** an automated test suite (61 tests) and a CI pipeline now exist; the "admin types your password" invite anti-pattern is gone, replaced with a real email-invite flow; login has rate limiting; the tenant-isolation gap in the corporate-BSC data helper is closed; audit logging now covers team invites, org-hierarchy saves, and document exports in addition to scorecard edits and tenant/license admin actions; cascade weighting is configurable via a settings screen instead of a silent hardcoded default; the duplicated `department` field across `org_positions` and `users` is consolidated to one source of truth; the unguarded org-hierarchy recursion that risked crashing the nightly performance-recalc job on corrupted data is fixed; the duplicated invite/account-creation logic is consolidated into one helper; the Super Admin tenant list is paginated instead of silently capped by PostgREST's default row limit; and all three cron jobs process tenants with bounded concurrency instead of a fully serial loop.

**What still prevents it from being a production-grade enterprise platform:** no MFA, no in-app or email notifications, no user self-service (signup, profile editing), no billing integration behind the "license" concept, and no observability/monitoring stack (no error tracking of any kind). These remain real gaps — none of the fixes above touched them.

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

**Safina's rating: still Level 2 (Functional MVP), but materially closer to Level 3 than at the original baseline.** Tests, CI/CD, and meaningful security hardening (rate limiting, tenant-isolation fix, extended audit logging, baseline security headers) now exist — three of Level 3's four requirements. **Monitoring is the one remaining gate**: there is still no error tracking or observability tooling of any kind, so a production incident today would be discovered by a user reporting it, not by the system. That single gap is what's holding the rating at Level 2 rather than 3.

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
| In-app notifications (bell/notification center) | **Missing** | No notification table anywhere in the schema (unchanged) |
| Email/SMS notifications | **Missing** | No mail/SMS package in `package.json` (unchanged) |
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

**Database:** Single shared Postgres instance (Supabase), 26 tables across 17 sequential migrations (one added this session: `login_attempts`), shared-schema multi-tenancy via `tenant_id` + Row-Level Security on every tenant-scoped table. Every FK and `tenant_id` column is indexed.

**Auth:** Supabase Auth, email/password only. Two client tiers: an RLS-scoped client for normal use, and a `server-only` service-role client (`src/lib/supabase/admin.ts`) that bypasses RLS. The one place that previously trusted a caller to have pre-scoped by tenant (`getCorporateBscView`) now asserts `tenantId` internally. Login now has Postgres-backed rate limiting (`src/lib/rate-limit.ts`) — 5 attempts/15min per email, 20/15min per IP.

**Storage:** One private Supabase Storage bucket (`company-documents`), tenant-isolated by folder-prefix RLS policy.

**AI:** Anthropic SDK (`claude-sonnet-5`), used with forced tool-calling (structured JSON output, not free text) for scorecard generation, theme generation, and document-section generation. Logged to an `ai_sessions` table.

**Infrastructure:** Vercel deployment, 3 scheduled cron jobs (`daily-tasks`, `performance-recalc`, `weekly-advisory`). **Fixed** — each now processes tenants with bounded concurrency (`src/lib/concurrency.ts`, a worker-pool capped at 5 concurrent tenants) instead of a fully serial loop; positions within a tenant still process sequentially by design, to keep total concurrent AI-API calls predictable. No region pinning, no CDN configuration beyond Vercel defaults, no containers/Kubernetes. `maxDuration` is still not set on the cron routes — the achievable value depends on the Vercel plan tier, which couldn't be determined from the repository.

**DevOps:** **Fixed** — a CI pipeline now exists (`.github/workflows/ci.yml`: typecheck + lint + tests on every PR and push to `main`), and an automated test suite exists (Vitest, 61 tests across 8 files covering the scoring/cascade engine, tenant isolation, cron auth, rate limiting, and the shared invite helper). True RLS/Postgres integration testing remains out of scope — no Supabase CLI/Docker access in this environment to run a local Postgres instance against the real policies; what exists tests the application-layer logic that supplements RLS. Secrets via `process.env`, no secrets manager beyond Vercel's own env-var store.

**Integrations:** Anthropic (AI), Supabase (DB/Auth/Storage). No payment/billing provider, no email/SMS provider, no CRM/ERP/accounting integration, no identity provider (no SSO/SAML/OIDC beyond Supabase's own auth), no monitoring/observability provider (no Sentry, Datadog, etc. in dependencies) — **unchanged, still a real gap**.

---

## 4. Multi-Tenancy Assessment

Real, not cosmetic: every tenant-scoped table has RLS enabled with a `tenant_id = current_tenant_id() OR is_super_admin()` policy. Storage follows the same pattern via folder-prefix policy. This is a **shared-database, shared-schema** model — one Postgres instance, tenant isolation entirely at the row level, no per-tenant schema/database, no tenant-selectable data residency.

**Can it scale to thousands of organizations?** Plausibly, for the database layer itself — Postgres with proper indexing handles millions of rows fine. **The cron scaling ceiling identified in the original baseline is improved, not eliminated.** All three scheduled jobs now process up to 5 tenants concurrently instead of one at a time, which meaningfully pushes out the point at which tenant count causes a function-timeout failure — but it doesn't remove the ceiling. A true fix (a real job queue, or per-tenant fan-out invocations) would require new infrastructure and was deliberately not built speculatively, consistent with this document's own recommendation not to over-build ahead of an actual scale signal.

**To millions of organizations:** would still require a fundamentally different tenancy/infrastructure model. Not a near-term concern given current usage.

---

## 5. Security Posture

| Control | Status |
|---|---|
| Tenant isolation (RLS) | **Implemented**, consistent across schema; the one gap found (`getCorporateBscView` trusting caller pre-scoping) is fixed |
| Secrets hygiene | **Implemented** — no hardcoded secrets, service-role key `server-only` |
| Audit logging | **Fixed — now broadly implemented.** Scorecard edits, tenant/license admin actions, team invites, org-hierarchy saves, document exports, and cascade-weight changes are all logged. Still not logged: individual task status changes, login/logout events |
| Rate limiting (login) | **Fixed — Implemented.** Postgres-backed (no Redis/KV available in this deployment), 5/15min per email + 20/15min per IP. Other Server Actions still have no rate limiting |
| MFA | **Missing** (unchanged) |
| CSP | **Missing** — baseline headers (frame-options, content-type-options, referrer-policy, permissions-policy) are implemented; CSP itself remains deliberately deferred pending a live environment to verify against without breaking auth/Supabase/document-export flows |
| Centralized authorization layer | **Missing** — inline checks only, RLS as backstop (unchanged) |
| Fine-grained ACL (`user_permissions` table) | **Dead schema** — defined with RLS policies, never referenced by application code (unchanged) |
| Automated security testing (SAST/DAST/dependency scanning) | **Missing** — CI now exists (typecheck/lint/test) but runs no security-specific scanning |
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
| No automated tests | **Fixed** — 61 tests across 8 files, covering the scoring/cascade engine, tenant isolation, cron auth, rate limiting, invite rollback, and concurrency helper | Was P1 |
| No CI/CD | **Fixed** — `.github/workflows/ci.yml` runs typecheck + lint + test on every PR and push to `main` | Was P1 |
| `user_permissions` table exists with RLS but is never used | **Not fixed** — still needs a decision: implement or drop | P3 |
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
| Functional Completeness | 58 (55) | Invite flow and department consistency are now real; no major new feature surface |
| Architecture | 55 (50) | Cron concurrency, consolidated invite logic |
| Security | 55 (45) | Rate limiting, extended audit logging, tenant-isolation fix, baseline headers — still missing MFA, centralized authz, SAST/DAST |
| Privacy | 25 (25) | No change |
| Scalability | 45 (30) | Both concrete ceilings found (cron serial loop, unbounded admin list) are fixed/improved — still no queue for true unbounded scale |
| Performance | 40 (40) | No change — still no load-test evidence either way |
| Reliability | 40 (35) | Cycle-guard fix removes one real crash vector |
| Data Architecture | 70 (65) | Department consolidation, cycle guard |
| UX | 50 (50) | Settings screen and invite flow improved; still unable to verify quality without live UI testing |
| DevSecOps | 40 (10) | The single largest jump — CI + test suite now exist; no SAST/DAST/secrets scanning yet |
| Compliance | 10 (10) | No change |
| Globalization | 5 (5) | No change |
| AI Readiness | 60 (60) | No change |
| Enterprise Readiness | 32 (25) | Real invite flow, configurable cascade weighting — still no SSO/MFA/billing/SLA |

**Overall maturity score: ~42/100, up from ~35/100.** The improvement is concentrated in DevSecOps, security, and scalability — the domains this session's work actually targeted — while privacy, compliance, and globalization are unchanged because nothing addressed them. That's the expected shape of a punch-list session, not a general uplift.

---

## 9. Pending Decisions

Two of the six original items are resolved; the rest remain open.

| Functionality | Status | Recommended default (if still open) |
|---|---|---|
| User invitation flow | **Resolved** — implemented the recommended default (Supabase email-invite, admin never sets a password) | — |
| `cascade_weights` configurability | **Resolved** — implemented the recommended default (settings screen at `/dashboard/settings`) | — |
| Billing/subscription model | **Still open** | Flat per-tenant subscription via Stripe Billing — simplest, matches the current tenant-level license model |
| Notification channel | **Still open** | Start in-app (cheapest, no new infra); add email once a provider is chosen for other reasons |
| Formal performance review workflow | **Still open** | Leave as auto-computed unless a specific customer/compliance need requires manager sign-off |
| Data residency requirements | **Still open, deliberately deferred** | Don't build speculative infrastructure until an actual deployment requires it |

---

## 10. Recommended Target Architecture (Directional, Not a Rebuild)

**Retain:** Next.js Server Actions model, Supabase Postgres + RLS-based tenant isolation, the AI tool-calling pattern for structured generation, the document-generation pipeline (docx/Puppeteer). These are sound choices for the current product, not technical debt.

**Completed this session, no longer open:** organization/department modeling, user invitation flow, automated test suite, CI/CD gate, pagination on the actually-unbounded read, rate limiting on `/login`, cascade-weight configurability, the duplicated invite logic, the unguarded hierarchy recursion.

**Still to add:** a notification system (additive, not a replacement of anything); basic observability (error tracking is the single highest-value addition remaining — right now a production failure is invisible until a user reports it); a real job queue if/when tenant count outgrows bounded concurrency.

**Defer until an actual need exists:** multi-region deployment, data residency controls, i18n/localization, formal ISO/SOC2 program, microservices decomposition, SAST/DAST scanning (valuable, but proportionate to add once there's a security review process to act on its findings, not before).

---

## 11. Priority Roadmap

**P0 — Critical (do before any external/production launch):** ~~rate limiting on login~~ done · ~~replace the password-sharing invite pattern~~ done · ~~audit-log the remaining sensitive actions~~ done for team creation/document export/onboarding saves.

**P1 — Very High:** ~~automated tests~~ done · ~~CI pipeline~~ done · **basic error monitoring — still open, the single highest-priority remaining item.**

**P2 — High:** ~~unguarded hierarchy recursion~~ done · ~~consolidate duplicated account-creation logic~~ done · ~~pagination~~ done (for the table that actually needed it) · ~~bound cron concurrency~~ done · ~~`cascade_weights` settings UI~~ done.

**P3 — Medium:** decide on and implement `user_permissions` (or remove it); notification system (in-app first); formal risk register and incident-response plan.

**P4 — Future:** billing integration; i18n/localization; data residency; multi-region deployment; formal compliance program (only once a specific customer or legal requirement names it).

---

## 12. Next Development Instructions Required From the Client

Everything from the original list is done. In priority order, what's actually left:

1. **"Add basic error monitoring."** — the single highest-value remaining gap. A production failure today is invisible until a user reports it. Needs a provider decision (Sentry is the conventional default) before implementation.
2. **"Decide on `user_permissions`: implement fine-grained resource-level ACLs, or drop the unused table."** — currently misleading dead schema; either direction is fine, leaving it half-present isn't.
3. **"Build an in-app notification system."** — no channel exists at all today beyond the dashboard's alerts panel, which is page-scoped only.
4. **"Add a real job queue for the cron routes"** — only once tenant/position counts actually approach what bounded concurrency can't handle; don't build this speculatively.
5. **"Decide on a billing provider and wire it behind the existing `license_tier`/`license_status` fields."** — needed before any real commercial launch, but is a business decision, not something to build ahead of that decision.

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
14. This update — revised the assessment to reflect all of the above
