# Admin Panel — Post-Hardening Executive Summary (Audit v2)

**Date:** 2026-06-27 · **Scope:** `admin-panel-discovery` @ `main` (`4016a1a`) + shared Supabase `jsykbnkbrwwsxcdurzcw` + Cloudflare Pages `shashki-royale-admin`.
**Method:** Source review of current `main`, read-only production probes, git-history review. **No production mutations.**

## TL;DR

The previous P0-hardening was **merged into `main` AND substantially applied in production** — this is materially better than "PR merged ≠ applied" pessimism would suggest. The most dangerous prior finding (anonymous administrative RPC bypass) is **verifiably CLOSED**. However, **three real, currently-live issues remain**, and the realtime layer is built on the exact insecure pattern the brief warns against.

## What the prior audit claimed vs. what production actually shows

| Prior claim | Verified status (2026-06-27) | Evidence |
|---|---|---|
| Anonymous can call admin grant/refund/suspend RPC | **FIXED — CLOSED** | All admin RPC → `42501 permission denied` for `anon` |
| `repair_2026_06.sql` RPCs (`*_v2`) deployed | **APPLIED (RPCs + tables exist)** | `admin_*_v2` resolve & deny anon; `admin_operations/_users/_rate_violations` tables exist |
| HttpOnly cookie session | **CONFIRMED in code & prod** | `/api/auth/login` sets `HttpOnly; Secure; SameSite=Strict`; body has no token |
| CSP/HSTS/COOP/CORP/Permissions-Policy | **CONFIRMED on HTML** | Header capture |
| Source maps hidden | **CONFIRMED** | No `*.map` in dist; `sourcemap:false` |
| Auth gate on all admin routes | **CONFIRMED** | `/api/admin/overview` → 401 without cookie |
| Old secrets rotated / history rewritten | **NOT DONE** | Handoff `.docx` with `ghp_`+JWT still reachable at `6429c1c` |

## Top remaining risks (live)

1. **CRIT — Secrets in git history.** A handoff `.docx` containing a GitHub PAT + a JWT remains reachable at commit `6429c1c`. The GitHub PAT used to authorize *this very engagement was also pasted into a chat channel*. **Rotate all of them.** (V2-001)
2. **HIGH — Raw `profiles` table is anon-readable**, exposing `player_id`, `auth_user_id`, `email` (currently null but column is selectable). PII/privacy + identity-mapping leak that also under-pins the insecure realtime design. (V2-002)
3. **HIGH — Insecure realtime architecture.** The admin SPA subscribes the **browser directly to public tables via the anon key** and depends on permissive RLS (`profiles`, `game_stakes`, `games`, `moves` all anon-readable). This is precisely the "fast integration" the brief prohibits. Private domains (wallets, ledger, audit, suspensions) cannot stream this way at all. (V2-003)
4. **MED — `game_stakes` fully anon-readable** (entry_fee, pot, both profile ids, escrow/payout status). Economy data exposed to the public. (V2-004)
5. **MED — Login rate-limit fails OPEN** and is best-effort; the only hard cap is an *assumed* Cloudflare Rate-Limiting Rule that this audit could not verify exists. (V2-005)
6. **MED — Single hard-coded `owner` role; no RBAC, no MFA.** `role:"owner"` is minted unconditionally at login; `admin_users` table exists but is not part of identity. Disabled-admin / role-change revocation is impossible. (V2-006)
7. **LOW/MED — Function-response security headers + unbounded aggregation scans** (see DB/API re-audits).

## Verdict snapshot (see ADMIN_FINAL_REPORT_V2.md for full scoring)

- **Anonymous RPC bypass:** CLOSED ✅
- **SQL repair applied:** YES ✅
- **Secrets rotated:** NO ❌ (blocking)
- **Realtime without refresh:** PARTIAL — works for public tables only, via insecure anon-subscription ⚠️
- **Realtime protected from anon:** NO — relies on RLS that is too permissive ❌
- **Multi-role ready:** NO ❌
- **Can keep admin writes enabled:** YES, with monitoring (RPCs are atomic & idempotent server-side) ✅
- **Can production-deploy light theme:** YES after CI ✅
- **Can auto-merge to main:** NO — owner approval required ❌

## Recommended sequencing
P0: rotate secrets + history rewrite (V2-001). P0: lock down `profiles`/`game_stakes` RLS + introduce sanitized views (V2-002/004). P1: replace anon realtime with the Cloudflare authenticated gateway (ADR Option B/C, V2-003). P1: real RBAC via `admin_users` (V2-006). P2: light theme, observability, CF rate-limit verification.
