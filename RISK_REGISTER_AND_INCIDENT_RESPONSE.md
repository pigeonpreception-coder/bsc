# Safina BSC Platform — Risk Register & Incident Response Plan

**Created 2026-08-13**, as part of the Level 4 ("Enterprise Platform") groundwork identified in [SAFINA_CURRENT_STATE_ASSESSMENT.md](SAFINA_CURRENT_STATE_ASSESSMENT.md) §11 (P3: "formal risk register and incident-response plan"). This document has two parts that are deliberately different in kind:

- **§1, the risk register**, is derived directly from this repository's actual architecture, vendors, and the eight gap-scan passes already completed (§14–§21 of the assessment doc) — it's a factual inventory, not aspirational.
- **§2, the incident response plan**, is a process document. The steps are concrete and usable today for a solo-founder operation. The numeric commitments in §3 (SLA targets) are **placeholders** — deliberately not invented here, since they're a business decision (what you're willing to commit to a customer, and what your vendors' own SLAs actually support), not a technical one. Fill those in when a customer contract or your own risk appetite requires a specific number.

This is not a compliance certification (SOC2, ISO 27001, etc.) and doesn't claim to be one — see §4 for what that would actually require beyond this document.

---

## 1. Risk Register

Each row: the risk, its source/trigger, current mitigation (what's actually built, not aspirational), residual likelihood/impact, and owner.

### 1.1 Data & Tenant Isolation

| Risk | Trigger | Current Mitigation | Residual Risk | Owner |
|---|---|---|---|---|
| Cross-tenant data exposure (one customer sees another's strategic plan, KPIs, or org data) | A bug in an RLS-bypassing admin-client query that trusts a caller-supplied id without a tenant check | Postgres RLS enforced on every table via `current_tenant_id()`; every RLS-bypassing admin-client function found during 8 gap-scan passes was hardened to assert `tenant_id` explicitly (see assessment §14–§20). No known open instance as of this document's date. | **Medium** — the pattern has recurred 8+ times across passes; a 9th pass finding a 9th instance is the expected case, not a surprise, per the assessment doc's own conclusion. | Whoever runs the next gap-scan pass |
| A tenant's data survives after they cancel/are deleted (retention/right-to-erasure risk) | Tenant offboarding, GDPR/CCPA-style deletion request | Not implemented — no tenant hard-delete or data-export flow exists today. | **Medium-High if any customer is in a jurisdiction requiring erasure rights** — currently unmitigated by design (no customers require it yet, per assessment §9). | Product decision needed before first EU/CCPA-covered customer |
| A single shared Postgres instance means a severe bug or Supabase-side incident affects every tenant simultaneously | Database-level outage or a bug affecting all tenants (no per-tenant blast-radius isolation) | Supabase's own infrastructure SLA/backups apply; no app-level mitigation (by design — see assessment §10, deferred until scale requires it) | **Medium** — acceptable at current single-region, small-tenant-count scale; revisit if a customer requires dedicated infrastructure | N/A until scale/contract requires it |

### 1.2 Authentication & Access

| Risk | Trigger | Current Mitigation | Residual Risk | Owner |
|---|---|---|---|---|
| Credential-stuffing / brute-force login | Automated login attempts against real user emails | Rate limiting on `/login` (Postgres-backed, per-email + per-IP, see `src/lib/rate-limit.ts`) | **Low** | — |
| Account takeover via leaked password, no second factor | Password reuse/leak outside this app | Password-reset flow revokes other sessions on change (assessment §18/§19); **no MFA exists yet** — this is the explicit Level 4 gap this document's companion MFA implementation targets | **Medium-High until MFA ships** — this is the single largest authentication gap today | In progress — see MFA plan |
| Privilege escalation via a missing or wrong role check on a Server Action | A new Server Action shipped without its authorization gate | Full role-check sweep completed in gap-scan pass 6 (assessment §19) — no gaps found at that time; not re-verified for code shipped since | **Low-Medium** — same "needs re-checking after each pass" caveat as tenant isolation | Whoever runs the next gap-scan pass |
| Session fixation / stale sessions after credential change | Attacker retains a session opened before the legitimate user changed their password | `revokeOtherSessions()` implemented with caller-ownership verification (assessment §19) | **Low** | — |

### 1.3 AI / LLM Integration

| Risk | Trigger | Current Mitigation | Residual Risk | Owner |
|---|---|---|---|---|
| Prompt injection via uploaded documents or scraped website content feeding into AI generation | A malicious or careless input document/URL used as AI context | SSRF guard on `fetchWebsiteText` (blocks private/reserved IPs, assessment §16); upload MIME/size limits and `.pptx` decompression-bomb guard (§16); no explicit prompt-injection-specific sanitization beyond that | **Medium** — SSRF and resource-exhaustion vectors are closed, but a document containing adversarial text designed to manipulate the AI's output (not to break the app, just to produce bad/misleading strategic-plan content) has no specific defense. Low severity here since output always goes through a human company_admin review step before becoming the tenant's live plan. | Accepted risk — revisit if AI output starts being trusted without human review |
| Unbounded AI spend (cost-based DoS) | Repeated/automated calls to AI-generation Server Actions | Rate limiting (`ai_generation` action type, 20/15min per user, §18); payload-size caps on the free-text fields that feed prompt context (§19) | **Low** | — |
| Anthropic API outage or rate-limit breaches AI-dependent features | Vendor-side incident or Safina exceeding its own Anthropic account limits | No fallback/circuit-breaker; AI-generation actions will simply error to the user | **Medium** — acceptable given AI generation is not on the critical path for already-created plans (KPI tracking, scoring, and viewing existing plans all work without the AI vendor) | Anthropic account owner |

### 1.4 Third-Party Vendor Dependency

| Vendor | Role | What happens on vendor outage | Residual Risk |
|---|---|---|---|
| Supabase | Postgres, Auth, Storage — the entire data and auth layer | Total application outage — no fallback exists or is planned | **Accepted** — this is the foundational architecture choice; mitigating it means building a different product |
| Vercel | Hosting, cron scheduling | Total application outage | **Accepted**, same reasoning |
| Anthropic (Claude API) | AI plan/scorecard/task generation | AI-dependent features fail; rest of the app (viewing, editing, KPI entry, scoring) is unaffected | **Low** |
| Resend | Notification emails | Emails silently don't send — `sendNotificationEmail` no-ops without throwing (by design, see `src/lib/email.ts`); in-app notification bell is unaffected since it's a separate write | **Low** |
| Sentry | Error monitoring | Errors stop being reported, but the app itself keeps functioning (gated to be inert-safe, see assessment §3) | **Low**, though it does mean incidents could go undetected — see §2.2 |

### 1.5 Operational

| Risk | Trigger | Current Mitigation | Residual Risk | Owner |
|---|---|---|---|---|
| Scheduled background jobs (daily tasks, performance recalc, weekly advisory) silently fail to run | A routing-layer bug intercepts the request before the job's own auth check — this exact bug existed until gap-scan pass 8 (assessment §21) fixed a middleware redirect that was silently intercepting every cron invocation | Fixed in §21; each cron route independently authenticates via `CRON_SECRET`, checked with a timing-safe comparison | **Low now, was High until §21** — the fact that this went undetected for an unknown period (no alerting existed to catch a redirected cron job) is itself a residual finding — see the alerting gap below |
| No alerting on cron-job failure specifically (as opposed to Sentry catching an unhandled exception) | A cron job's request never reaches the handler (as in the bug above), or fails silently for another reason | None — Sentry only catches errors that are actually thrown; a redirected or no-op request throws nothing | **Medium** — worth a lightweight fix: have each cron route log/alert on unexpectedly-empty result sets, or use Vercel's own cron-monitoring dashboard as the primary check | Recommend as a near-term follow-up, not part of this document's scope |
| Secrets committed to git history | Accidental commit of an API key or credential | Gitleaks scans full git history on every push/PR + weekly (assessment §17) | **Low** |
| Known-vulnerable dependency shipped to production | A CVE in a direct or transitive npm dependency | Dependabot + CodeQL SAST run on every push/PR + weekly (assessment §17) | **Low** |
| Single-founder bus factor — no one else can operate/patch the system | Founder unavailability (illness, etc.) | None — explicitly out of scope for a technical document, but worth naming here since it's a real operational risk for any solo-founder SaaS | **Accepted** — a business continuity decision, not a code fix |

---

## 2. Incident Response Plan

Scoped for the actual size of this operation today (solo founder, no dedicated ops team) — this is a usable checklist, not a framework that assumes a security team exists.

### 2.1 Severity Levels

| Level | Definition | Example |
|---|---|---|
| **SEV1 — Critical** | Active cross-tenant data exposure, credential compromise, or total outage | A tenant can see another tenant's data; the app is fully down; admin credentials are confirmed leaked |
| **SEV2 — High** | A confirmed vulnerability with no evidence of active exploitation, or a partial outage | A gap-scan pass finds an unfixed cross-tenant write gap; AI generation is down but the rest of the app works |
| **SEV3 — Medium** | A defense-in-depth gap, or a degraded-but-functional state | Missing rate limit on a low-risk action; email notifications not sending |
| **SEV4 — Low** | Cosmetic, or a hardening opportunity with no realistic exploit path | A missing security header with no known bypass value |

### 2.2 Detection

What actually generates a signal today, and what doesn't:

- **Application errors**: Sentry (once `NEXT_PUBLIC_SENTRY_DSN` is confirmed live — see assessment §1 verification caveat). Catches thrown exceptions in server, edge, and client runtimes.
- **Dependency/code vulnerabilities**: CodeQL + Dependabot + gitleaks, all running in CI on every push/PR plus weekly.
- **Manual gap-scan passes**: ad hoc, run on request — not on a schedule. Eight passes completed as of this document; the assessment doc's own conclusion is that these keep finding real issues and shouldn't be assumed exhausted.
- **What has no automated detection today**: cross-tenant data exposure in production (would only surface via a customer report or a future gap-scan pass, not an alert); a cron job silently not running (no alert distinct from Sentry — see risk register §1.5); failed login patterns beyond what triggers rate limiting; unusual admin/super-admin activity (audit log exists and is queryable, but nothing actively monitors it).

### 2.3 Response Steps

1. **Contain.** For a confirmed SEV1 data-exposure issue: identify the exact query/action responsible, and if it's actively reachable, the fastest containment is usually disabling the specific feature (e.g. via a feature flag if one exists, or a hotfix deploy) rather than taking the whole app down — but taking the app down is justified if containment can't be done surgically within minutes.
2. **Assess scope.** Use the audit log (`audit_log` table, written via `writeAuditLog()` — covers scorecard edits, team invites, org-hierarchy saves, document exports, tenant/license admin actions) to determine which tenants/records were actually touched, not just theoretically exposed.
3. **Fix.** Patch the root cause, not just the symptom — this repo's own convention (see the 8 gap-scan passes) is to trace to the actual unchecked query/action, not add a surface-level guard.
4. **Verify.** Run the full check sequence before considering the fix complete: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, plus manual confirmation the specific exploit path is closed.
5. **Notify.** For a confirmed SEV1/SEV2 involving actual (not just theoretical) cross-tenant exposure: affected tenant admins should be notified directly, not just via a changelog entry. What "directly" means (email, call) and any regulatory notification obligations (breach-notification laws vary by jurisdiction and depend on what data was exposed) is a case-by-case legal question outside this document's scope — get legal advice before committing to a notification approach or timeline if real customer data was actually exposed, as opposed to a gap found and closed before any exploitation occurred.
6. **Document.** Add an entry to this document's §2.4 log and to the assessment doc's changelog (§13), same as every gap-scan pass already does — this repo's established pattern of writing down what happened and why should extend to real incidents, not just proactive scans.

### 2.4 Incident Log

*(Empty as of this document's creation — no incidents recorded. Add entries here as they occur: date, severity, summary, root cause, resolution, notification sent y/n.)*

---

## 3. SLA Targets — Placeholder, Requires a Business Decision

**Not filled in deliberately.** These numbers are commitments to customers, not technical facts — inventing them here would misrepresent them as already-decided. Before setting real numbers, check what your actual vendor stack can support:

| Metric | Placeholder | What to check before committing |
|---|---|---|
| Uptime | `___%` (e.g. 99.5%) | Supabase's and Vercel's own published SLAs for your plan tier — you can't credibly commit to more than your vendors do |
| Incident response time (SEV1) | `___ hours` | Realistic for a solo founder — don't commit to 24/7/1-hour response unless that's actually true |
| Support response time | `___ business hours/days` | Depends entirely on what support channel/staffing you're actually running |
| Data backup frequency / retention | Supabase's default backup schedule for your plan, or a custom policy | Check your actual Supabase plan's backup configuration — don't assume without verifying |
| Planned maintenance windows | Not yet defined | Only needed once you have customers with uptime expectations |

---

## 4. What This Document Is Not

- **Not a SOC2 or ISO 27001 certification**, or evidence toward one. Those require a formal audit by an accredited third party, a much longer evidence-retention and control-testing history than this document represents, and typically 6–12+ months of demonstrated operation under the controls before an auditor will even engage. This document is useful *input* to that process later, not a substitute for it.
- **Not legal advice** on breach notification, data residency, or regulatory obligations (GDPR, CCPA, etc.). Get an actual lawyer before making representations to customers about any of that.
- **Not a guarantee** that the risk register above is exhaustive — it reflects what eight gap-scan passes and this repository's actual architecture have surfaced as of 2026-08-13, consistent with every other document in this repo's explicit policy of only claiming what's been verified.
