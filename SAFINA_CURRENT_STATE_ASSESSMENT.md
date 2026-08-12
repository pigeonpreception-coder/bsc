# Safina BSC Platform — Current-State Assessment, Gap Analysis & Target Architecture

**Baseline document.** Everything below is derived from direct inspection of this repository — source code, all 16 Supabase migrations, config files, and dependency manifests — as of 2026-08-12. Where something couldn't be verified from available evidence (load behavior, real-world usage, UX quality under actual use), that's stated explicitly rather than inferred. Nothing here should be read as a compliance or certification claim; none exist yet. This supersedes the narrower [SECURITY_ARCHITECTURE_ASSESSMENT.md](SECURITY_ARCHITECTURE_ASSESSMENT.md) written earlier this session, which remains accurate for the specific fixes it documents.

---

## 1. Executive Summary

Safina is a **working, single-region, multi-tenant SaaS application** for Balanced Scorecard–based strategic management: an organization's admin sets up mission/vision/values, generates an AI-assisted strategic plan and a cascading Balanced Scorecard, staff update their KPI actuals, and the system computes RAG status, weighted performance scores, and exports the finished plan as Word/PDF. It is built on Next.js 16 (Server Actions, not a REST API) and Supabase (Postgres + Auth + Storage), deployed to Vercel with three scheduled cron jobs.

**What it solves today:** a small-to-mid-size organization can go from "we have no formal strategic plan" to a generated, editable, cascaded Balanced Scorecard with live KPI tracking and a board-ready exported document — without needing a consultant to build the template by hand. That core loop is real and functionally complete.

**What prevents it from being a production-grade enterprise platform right now:** no automated tests of any kind, no CI/CD pipeline, no MFA, no rate limiting, no in-app notifications, no user self-service (signup, profile editing, invitations are really "admin types your password for you"), no billing integration behind the "license" concept, no pagination anywhere (fine at current scale, a real ceiling later), and no observability/monitoring stack. These are not exotic enterprise features — they're baseline hygiene for a product handling other companies' strategic and performance data.

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

**Safina's rating: Level 2 (Functional MVP), bordering Level 3 for its core strategy/BSC workflow specifically.** The BSC generation → scorecard → performance → export loop is coherent and complete enough to demo and use in earnest. It is rated Level 2 overall, not Level 3, because the cross-cutting hygiene that defines "production application" — tests, CI/CD, monitoring, rate limiting, MFA — doesn't exist anywhere in the codebase, not just in edge cases.

---

## 2. What Has Been Built — Module Inventory

Legend: **Complete** (feature-complete for its scope) · **Functional** (works, real limitations) · **Partial** (exists but materially incomplete) · **Placeholder** (UI/schema exists, no real behavior) · **Missing** (does not exist)

### User & Organization Management

| Feature | Frontend | Backend | Database | Status |
|---|---|---|---|---|
| Login | ✅ | `src/app/login/actions.ts:6-39` | `public.users` | Functional |
| Forgot/reset password | ✅ | `src/app/auth/forgot-password/actions.ts` | Supabase Auth | Functional |
| Self-serve signup | — | — | — | **Missing** — every account is created by an admin |
| MFA | — | — | — | **Missing** — zero references anywhere in the codebase |
| User profile self-management | — | — | — | **Missing** — no route to edit own name/email; password only changes via forced reset link |
| "User invitations" | `AddTeamMemberForm.tsx` | `team/actions.ts:7-68` | `public.users` | **Placeholder** — admin types the new user's password directly and creates a live account; not an email-invite/token flow. `admin/actions.ts` (`createCompanyAdmin`) duplicates this same pattern independently |
| Account activation/deactivation | — | — | — | **Missing** — no status/active column on `users` at all |
| Tenant creation | `NewTenantForm.tsx` | `admin/actions.ts:15-55` | `public.tenants` | Functional (super_admin only) |
| Departments/teams | — | — | `org_positions.office_department_name` + duplicate free-text `users.department` | **Partial** — no real `departments` entity, two unlinked free-text copies of the same concept |
| Positions & reporting lines | `OrgWizard.tsx` | `onboarding/actions.ts:29-100` | `org_positions.reports_to_id` (self-FK) | Functional, but hierarchy traversal (`getDepth()`, `src/lib/performance.ts:211-215`) has **no cycle guard** |
| Branches/business units | dashboard label only | — | — | **Missing** — "Branch/Department" is a UI label over the same `org_positions` unit, not a real structural concept |
| Subscription/licensing | `LicenseStatusForm.tsx` | `admin/actions.ts:57-86` | `tenants.license_tier/status` | **Placeholder** — manually-set admin dropdown, no billing/payment integration of any kind |

### Strategic Management & Balanced Scorecard

| Feature | Status | Evidence |
|---|---|---|
| Mission/vision/values | Complete | `questionnaire/actions.ts:47-117`; autosaved |
| Strategic themes (fixed at 4) | Functional | AI-generated via `src/lib/strategic-theme-generation.ts`, editable |
| Strategic objectives + theme alignment (many-to-many) | Functional | `strategic_objective_themes` junction table |
| Strategic initiatives as a real entity | **Placeholder** | No dedicated table — folded into a free-text `key_initiatives` column on scorecard rows; not trackable/assignable |
| Full BSC template (perspectives, KPIs, baselines, targets, actuals, weights) | Complete | 14/16-column GES template, `src/lib/scorecard.ts` |
| RAG auto-scoring | Complete | `computeAutoStatus`, deterministic thresholds (≥95% on-track / 80-94% at-risk / <80% off-track) |
| Cascading (corporate → dept → individual) | Functional | `calculatePerformanceScores()`, `cascade_weights` table — **weights are not editable via any UI**, silently falls back to hardcoded defaults |
| AI-generation | Functional | Real structured-output tool-calling against Claude (not free-text) generates scorecard rows, themes, and plan-document sections; old single-shot free-text flow was deliberately removed (`0016_drop_ai_generated_content.sql`) |

### Performance Management & Analytics

| Feature | Status | Evidence |
|---|---|---|
| Composite/weighted score calculation | Functional | `src/lib/performance.ts:133-291` |
| Daily historical snapshot + 30-day trend chart | Functional | `saveDailySnapshot()`, one chart type (recharts line chart) |
| Per-edit history log (`performance_snapshots`) | **Write-only** | Inserted on every actual-value edit; no report/UI ever reads it back |
| Formal review/approval of scores or ratings | **Missing** | Scores are purely computed from actual-vs-target; no manager sign-off step exists anywhere |
| Evidence/attachment on a KPI actual | **Missing** | No file/URL column on `scorecard_rows`; file upload exists only for the separate "business profile supporting documents" feature |
| Cross-department benchmarking / predictive analytics | **Missing** | "Weekly advisory" is an AI-generated text narrative comparing last week to this week — not a forecast or model |
| Alerts (KPI at-risk/off-track, task rollover) | Functional | Deduplicated, dashboard-panel only |
| Alert type `overdue_task` | **Dead schema** | Allowed by the DB CHECK constraint and styled in the UI, but no code path ever inserts one |
| Daily AI-generated tasks | Functional | Self-rated completion (1-5), no manager sign-off, no manual task assignment exists at all |

### Workflow, Documents, Notifications & Admin

| Feature | Status | Evidence |
|---|---|---|
| Manual task assignment (person→person) | **Missing** | Only insertion path into `daily_tasks` is the AI generator |
| In-app notifications (bell/notification center) | **Missing** | No notification table anywhere in 16 migrations |
| Email/SMS notifications | **Missing** | No mail/SMS package in `package.json` |
| Reminders / SLA management / escalation | **Missing** | Zero matches for these concepts anywhere in `src/` |
| General approval workflow | **Single instance only** | `approveStrategicPlan()` — one status flip, the only approval action in the entire app |
| Document generation (Word + PDF) | Complete | `docx` package + Puppeteer/`@sparticuz/chromium`; stored in Supabase Storage, signed URLs (1hr TTL), keeps last 3 versions |
| Document templates | **Not user-configurable** | Single hardcoded template (`private-corporate-sme.ts`) |
| Admin: tenant creation, license status, company-admin creation | Functional and audit-logged | `admin/actions.ts` |
| Admin: tenant deletion | **Missing** | No delete action exists |
| Admin: data export on termination | **Missing** | No export mechanism exists |
| Tenant-level configuration UI | **Missing** | No settings screen anywhere; `cascade_weights` exists in the DB with no editor |

---

## 3. Current Architecture

**Frontend:** Next.js 16.2.10 App Router, React 19.2.4, Server Components + Server Actions (no separate REST API for app logic — only 4 `route.ts` handlers exist, 3 of which are cron endpoints). Tailwind CSS 4. Charts via `recharts`.

**Backend:** No separate backend service — all business logic lives in Server Actions co-located with the routes that use them (`"use server"` files, ~13 of them). Authorization is inline `if (user.role !== ...)` conditionals (32 occurrences across 18 files), not a centralized policy layer.

**Database:** Single shared Postgres instance (Supabase), 25 tables across 16 sequential migrations, shared-schema multi-tenancy via `tenant_id` + Row-Level Security on every tenant-scoped table. Every FK and `tenant_id` column is indexed.

**Auth:** Supabase Auth, email/password only. Two client tiers: an RLS-scoped client for normal use, and a `server-only` service-role client (`src/lib/supabase/admin.ts`) that bypasses RLS, guarded only by call-site discipline plus (as of this session) an internal tenant assertion in the one place that previously lacked it.

**Storage:** One private Supabase Storage bucket (`company-documents`), tenant-isolated by folder-prefix RLS policy.

**AI:** Anthropic SDK (`claude-sonnet-5`), used with forced tool-calling (structured JSON output, not free text) for scorecard generation, theme generation, and document-section generation. Logged to an `ai_sessions` table.

**Infrastructure:** Vercel deployment, 3 scheduled cron jobs (`daily-tasks` 04:00 UTC, `performance-recalc` 22:00 UTC, `weekly-advisory` Mondays 05:00 UTC), each looping serially over every tenant inside one function invocation. No region pinning, no CDN configuration beyond Vercel defaults, no containers/Kubernetes.

**DevOps:** No CI/CD pipeline (no `.github/workflows` or equivalent exists). No automated test suite of any kind (zero `*.test.*`/`*.spec.*` files in the repo). Secrets via `process.env`, no secrets manager beyond Vercel's own env-var store.

**Integrations:** Anthropic (AI), Supabase (DB/Auth/Storage). No payment/billing provider, no email/SMS provider, no CRM/ERP/accounting integration, no identity provider (no SSO/SAML/OIDC beyond Supabase's own auth), no monitoring/observability provider (no Sentry, Datadog, etc. in dependencies).

---

## 4. Multi-Tenancy Assessment

Real, not cosmetic: every tenant-scoped table across all 16 migrations has RLS enabled with a `tenant_id = current_tenant_id() OR is_super_admin()` policy, verified individually per migration. Storage follows the same pattern via folder-prefix policy. This is a **shared-database, shared-schema** model — one Postgres instance, tenant isolation entirely at the row level, no per-tenant schema/database, no tenant-selectable data residency.

**Can it scale to thousands of organizations?** Plausibly, for the database layer itself — Postgres with proper indexing handles millions of rows fine, and the indexing here is consistent. **Cannot currently scale past low hundreds of tenants without changes** to the cron architecture: all three scheduled jobs iterate every tenant serially inside a single Vercel function invocation, which has a hard execution-time ceiling. This is the single most concrete scalability ceiling found in the codebase, not a hypothetical one.

**To millions of organizations:** would require a fundamentally different tenancy/infrastructure model (per-tenant sharding, or at minimum a real background-job queue instead of serial-loop-in-cron). Not a near-term concern given current usage.

---

## 5. Security Posture

Full detail in [SECURITY_ARCHITECTURE_ASSESSMENT.md](SECURITY_ARCHITECTURE_ASSESSMENT.md). Summary, classified per the requested framework:

| Control | Status |
|---|---|
| Tenant isolation (RLS) | **Implemented**, consistent across schema |
| Secrets hygiene | **Implemented** — no hardcoded secrets, service-role key `server-only` |
| Audit logging | **Partially implemented** — scorecard edits and super-admin/tenant actions logged (the latter fixed this session); team-member creation, document generation/export, task actions, onboarding saves, login/logout are not |
| MFA | **Missing** |
| Rate limiting (login, actions) | **Missing** |
| CSP | **Missing** — baseline headers (frame-options, content-type-options, referrer-policy, permissions-policy) added this session; CSP itself deliberately deferred pending a live environment to verify against |
| Centralized authorization layer | **Missing** — inline checks only, RLS as backstop |
| Fine-grained ACL (`user_permissions` table) | **Dead schema** — defined with RLS policies, never referenced by application code |
| Automated security testing (SAST/DAST/dependency scanning) | **Missing** — no CI pipeline to run any of it |
| ISO 27001 / SOC 2 / GDPR / other formal compliance | **Not applicable yet** — no evidence of, and no claim of, any formal compliance program. Would require legal review and external audit, not code changes |

---

## 6. Technical & Architectural Debt

| Problem | Impact | Risk | Recommended Solution | Priority |
|---|---|---|---|---|
| `getDepth()` recurses on `reports_to_id` with no cycle guard | Stack overflow / hang if hierarchy data is ever corrupted | Low likelihood (UI can't create a cycle today), high impact if it happens | Add a visited-set guard | P2 |
| Duplicate account-creation logic (`team/actions.ts` `addTeamMember` vs. `admin/actions.ts` `createCompanyAdmin`) | Same "admin types a password" pattern implemented twice independently | Drift risk — a fix/improvement to one won't propagate to the other | Extract a shared `createUserAccount()` helper | P2 |
| `department` duplicated as unlinked free text (`org_positions.office_department_name` vs `users.department`) | No single source of truth for "what department is this user in" | Data can silently diverge | Pick one, drop the other, or add an FK | P2 |
| `user_permissions` table exists with RLS but is never used | False sense of granular RBAC if someone assumes it's enforced | Low (nothing reads it today) but misleading | Either implement it or drop it — don't leave it half-present | P3 |
| `overdue_task` alert type allowed by schema/UI, never produced | Dead code path, confusing to a future maintainer | Low | Remove from CHECK constraint and UI, or implement it | P4 |
| No pagination anywhere (`.range()` never used) | Full-table fetch per request | Fine today; degrades as `audit_log`/`performance_history`/`daily_tasks` grow unbounded over years | Add pagination/date-windowing to unbounded-growth tables first | P2 |
| Cron jobs loop every tenant serially in one function call | Hard scaling ceiling on tenant count | Currently fine, becomes a hard failure past some tenant count | Move to a real job queue or fan out per-tenant invocations | P2 |
| No automated tests | Every change is a manual-regression risk | Confirmed by evidence (zero test files) | Start with the highest-risk paths: RLS/authz, scoring engine, cascade math | P1 |
| No CI/CD | No enforced gate before merge | Confirmed absence | Add a basic pipeline: typecheck + lint + (future) tests on PR | P1 |

---

## 7. Global Standards Alignment (Framework, Not Certification)

| Framework | Applicable? | Current Status | Gap | Priority |
|---|---|---|---|---|
| OWASP Top 10 | Yes | Partially addressed (RLS mitigates broken access control at the DB layer; secrets hygiene good) | No CSP, no rate limiting, no automated scanning | P1 |
| OWASP ASVS | Yes, as a target | Not assessed against formally | No SAST/DAST, no pen test | P2 |
| NIST CSF | Yes, as a target | Ad hoc | No formal risk register prior to this document, no incident-response plan | P3 |
| ISO/IEC 27001 | Aspirational only | Not started | Requires an ISMS, external audit — organizational work, not code | Future |
| GDPR / regional privacy law | Applicable if/when EU or other regulated customers onboard | Not addressed | No data-subject request workflow (export/delete-on-request), no documented lawful basis, no DPIA | High once relevant, not urgent pre-launch |
| Zero Trust (NIST SP 800-207) | Directionally relevant | RLS + role checks are a partial analog | No device/session risk signals, no continuous verification beyond session cookie validity | Future |

---

## 8. Product Maturity Scorecard (0–100)

| Domain | Score | Basis |
|---|---:|---|
| Functional Completeness | 55 | Core strategy/BSC/performance/export loop is genuinely complete; user mgmt, notifications, reviews, task assignment are thin or missing |
| Architecture | 50 | Clean and coherent for its current scale; no service boundaries, no caching/queue layer, single region |
| Security | 45 | Strong tenant-isolation foundation; missing MFA, rate limiting, CSP, centralized authz, automated scanning |
| Privacy | 25 | No data-subject-rights workflow, no consent mechanism, no residency controls |
| Scalability | 30 | Concrete ceiling in the serial-cron-per-tenant design; no pagination on unbounded tables |
| Performance | 40 | Indexing is sound; unable to verify behavior under real load — no load-test evidence exists |
| Reliability | 35 | Entirely dependent on Supabase/Vercel managed reliability; no app-level DR plan, no monitoring |
| Data Architecture | 65 | Consistently normalized, indexed, RLS-covered — one of the stronger areas |
| UX | 50 | Coherent structure from code (wizard, dashboard, editable table); **unable to verify quality without live UI testing** |
| DevSecOps | 10 | No CI/CD, no tests, no scanning pipeline of any kind |
| Compliance | 10 | No formal program; not claimed |
| Globalization | 5 | No i18n, no multi-currency, no locale handling |
| AI Readiness | 60 | Real structured-output AI integration already working in production paths, a genuine strength |
| Enterprise Readiness | 25 | No SSO/MFA, no billing, no SLA, no tenant self-service |

**Overall maturity score: ~35/100** — consistent with the Level 2 (Functional MVP) rating in §1. The number is pulled down specifically by DevSecOps, compliance, and globalization scores that reflect things genuinely absent, not underbuilt; it's pulled up by data architecture and AI readiness, which are real strengths.

---

## 9. Pending Decisions Required Before Certain Work Can Proceed

| Functionality | Why an instruction is needed | Information required | Recommended default |
|---|---|---|---|
| Billing/subscription model | `license_tier`/`license_status` are currently just admin-set flags with no payment provider behind them | Which billing model (seat-based, tenant-flat-rate, usage-based)? Which provider? | Flat per-tenant subscription via Stripe Billing — simplest to implement, matches the current tenant-level license model |
| User invitation flow | Current "invite" is really direct account creation with an admin-chosen password | Should invited users set their own password via emailed link instead? | Yes — replace with Supabase's built-in invite-by-email flow; removes the shared-secret-password anti-pattern |
| Notification channel | No notification system exists at all | In-app only, or also email? | Start in-app (cheapest, no new infra); add email once a provider is chosen for other reasons (e.g. invites) |
| Formal performance review workflow | Scores are currently pure computed values with no human sign-off step | Does the business actually require a manager-approval step on ratings, or is auto-computed sufficient? | Leave as auto-computed unless a specific customer/compliance need requires sign-off — don't build workflow the product doesn't need yet |
| `cascade_weights` configurability | Table exists but has no UI; currently silently defaults | Should company_admins be able to tune cascade weighting, or should it stay a fixed default? | Expose a simple settings screen — the data model already supports it, only the UI is missing |
| Data residency requirements | No current customer requires it | Are there specific countries/customers on the roadmap with a legal residency requirement? | Don't build speculative infrastructure — defer until an actual deployment requires it |

---

## 10. Recommended Target Architecture (Directional, Not a Rebuild)

**Retain:** Next.js Server Actions model, Supabase Postgres + RLS-based tenant isolation, the AI tool-calling pattern for structured generation, the document-generation pipeline (docx/Puppeteer). These are sound choices for the current product, not technical debt.

**Complete, don't rebuild:** organization/department modeling (add a real `departments` entity rather than duplicated free text), notification system (additive, not a replacement of anything), user invitation flow (swap the password-sharing pattern for Supabase's built-in invite, don't rearchitect auth).

**Add before scaling further:** automated test suite (starting with authz/RLS and the scoring engine — the highest-consequence logic), CI/CD gate, a real background-job mechanism to replace the serial-loop-in-cron pattern, pagination on unbounded-growth tables, rate limiting on `/login`, basic observability (error tracking at minimum).

**Defer until an actual need exists:** multi-region deployment, data residency controls, i18n/localization, formal ISO/SOC2 program, microservices decomposition. Building any of these speculatively, before a customer or regulatory requirement demands them, is pure cost with no current payoff — this is the same conclusion as the earlier security assessment and still holds.

---

## 11. Priority Roadmap

**P0 — Critical (do before any external/production launch):** rate limiting on login; replace the password-sharing invite pattern; audit-log the remaining sensitive actions (team creation, document export, onboarding saves).

**P1 — Very High:** automated tests for RLS/authz and the scoring/cascade engine; a minimal CI pipeline (typecheck + lint + tests on every PR); basic error monitoring.

**P2 — High:** fix the unguarded hierarchy recursion; consolidate the duplicated account-creation logic; add pagination to unbounded tables; move cron work off the serial-loop pattern; expose `cascade_weights` in a settings UI.

**P3 — Medium:** decide on and implement `user_permissions` (or remove it); notification system (in-app first); formal risk register and incident-response plan.

**P4 — Future:** billing integration; i18n/localization; data residency; multi-region deployment; formal compliance program (only once a specific customer or legal requirement names it).

---

## 12. Next Development Instructions Required From the Client

In priority order, the concrete instructions this assessment supports issuing next:

1. "Add rate limiting to the login action." — closes the most exposed unmitigated gap found.
2. "Replace the team/company-admin invite flow with Supabase's email-invite-and-set-own-password pattern, removing the admin-chosen-password anti-pattern in both `team/actions.ts` and `admin/actions.ts`."
3. "Extend audit logging to team-member creation, document generation/export, and onboarding saves" — closes the remaining forensic-trail gap identified in §5.
4. "Write an initial automated test suite covering tenant isolation (RLS) and the performance-scoring/cascade engine" — the two areas where a silent regression would be most damaging and least visible.
5. "Add a minimal CI pipeline (typecheck, lint, tests) that runs on every pull request."
6. "Build a `cascade_weights` settings screen for company_admins" — the data model already supports this; only the UI is missing.
7. "Consolidate `office_department_name` and `users.department` into a single source of truth."

Items intentionally **not** included here: multi-region infrastructure, formal compliance certification, i18n, and billing integration — each requires a business decision (§9) or an actual customer/regulatory trigger before it's worth building, not just more engineering time.
