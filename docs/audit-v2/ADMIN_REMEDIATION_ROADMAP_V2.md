# Admin — Remediation Roadmap (v2)

Priority = business risk × likelihood. Effort: S(<0.5d) M(0.5–2d) L(>2d).

## P0 — do first (blocking production trust)
| ID | Action | Effort | Owner action required |
|---|---|---|---|
| V2-001 | Revoke `ghp_` PAT + JWT in handoff history + the chat-pasted PAT; rotate `SUPABASE_SERVICE_ROLE`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH`; `git filter-repo` purge the docx; enable GitHub secret-scanning + push protection | M | **YES — owner rotates in GitHub/Supabase/Cloudflare** |
| V2-002 | Tighten `profiles` RLS (self+service); force public reads via `public_profiles` | M | YES — apply migration after staged verify + rollback |
| V2-004 | Tighten `game_stakes` RLS to participants+service | M | YES — same staged verify |

## P1 — security & realtime
| ID | Action | Effort |
|---|---|---|
| V2-003 | Ship Cloudflare authenticated realtime gateway (SSE) + new client; drop browser anon subscriptions | L |
| V2-006 | Real RBAC: make `admin_users` authoritative; roles owner/operator/analyst/support; per-user disable + password_version revocation; add MFA (TOTP) or Cloudflare Access | L |
| V2-005 | Verify/create Cloudflare login Rate-Limiting Rule; reconsider fail-closed + per-account lockout | S/M |
| V2-007 | Apply security headers inside Pages Function `json()` responses | S |
| V2-CICD-5 | `ADMIN_WRITES_ENABLED` kill-switch (503 when off) | S |
| V2-009 | Make audit-write failures visible (no silent swallow) + append-only mirror | M |

## P2 — quality, perf, ops
| ID | Action | Effort |
|---|---|---|
| B (theme) | Light premium redesign across all surfaces | L |
| V2-API-1 | Move large JS scans into SQL aggregates | M |
| V2-API-2/3 | Audit sensitive reads; echo `x-request-id` | S |
| V2-CICD-1/2 | Add `feat/**` CI trigger, lint, tests, dep-audit, CodeQL, Dependabot | M |
| V2-CICD-4 | Verify Supabase PITR + restore runbook | S |
| V2-UX-6 | Route-level code splitting | S |
| Ledger | Run `diag_reconcile.sql`; resolve any drift | M |

## What this engagement delivers
- **Audit branch** `audit/admin-panel-v2-realtime-readiness`: all docs above + evidence + diagnostics.
- **Implementation branch** `feat/admin-light-realtime`: light theme system + secure realtime gateway + client (V2-003 core, V2-007, kill-switch) — compiling & preview-ready.
- **Prepared (not auto-applied)** SQL for V2-002/004 with rollback notes.
- **Owner-only** items: secret rotation, applying RLS migration, CF rate-limit/PITR verification, MFA enrolment.
