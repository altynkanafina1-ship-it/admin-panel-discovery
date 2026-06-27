# Admin — CI/CD & Infrastructure Re-Audit (v2)

## CI (`.github/workflows/admin-panel.yml`)
- Triggers: PR→main, push→`main`/`fix/**`/`audit/**`. **Gap:** `feat/**` not in push triggers (V2-CICD-1) — implementation branch only gets CI via its PR. Add `feat/**`.
- Steps: `yarn install --frozen-lockfile` → `typecheck` → `build` → smoke (dist/index.html exists; **fails if any `*.map` leaked**). Verified locally: all pass; no maps. ✅
- **Gaps:** no `lint` in CI (script exists), no tests run (specs are `.md` only), no dependency audit (`yarn npm audit`), no CodeQL, no Dependabot config in repo, no secret-scanning workflow. (V2-CICD-2)

## Cloudflare Pages
- Project `shashki-royale-admin`; production = `main`. Branch previews appear to be auto-created by Pages' Git integration (mirrors the game's `feat-light-premium-game-them` alias). The implementation branch should therefore auto-generate a preview.
- **Env vars (`SUPABASE_SERVICE_ROLE`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, …)** are Pages-project bindings. **Must verify** they are *not* scoped such that preview deployments expose production write power without intent (V2-CICD-3). Preview should ideally use a read-only/test profile + separate `ALLOWED_ORIGIN`.
- **Headers:** `public/_headers` applies to static assets only — **not** to `/api/*` Function responses (confirmed: `/api/health` lacked HSTS/CSP). Set headers in `json()` (V2-007).
- **`access-control-allow-origin: *`** observed on static HTML — confirm it's the Pages default, harmless for non-credentialed assets, but document it.

## Resilience / ops
- **Backups / PITR:** Supabase PITR availability depends on the plan — **verify enabled** (V2-CICD-4). Document restore runbook.
- **Migration rollback:** SQL bundles are forward-only; no down-migrations. Capture pre-state (`diag_*.sql`) before any apply; keep a documented rollback for the RLS tightening (highest regression risk).
- **Emergency read-only mode / kill-switch for admin writes:** **absent** (V2-CICD-5). Add an env flag (e.g. `ADMIN_WRITES_ENABLED=false`) checked before grant/refund/suspend → returns 503 `writes_disabled`; lets the owner freeze economy mutations instantly without a redeploy of logic.
- **Dirty deployments / rollback history:** verify via Cloudflare dashboard; out of scope for code review.

## Dependencies
- `react 18.3`, `@supabase/supabase-js ^2.104`, `recharts 2.15.4` (pinned), `wrangler 3.99`. No lockfile drift observed (`--frozen-lockfile` installs cleanly). Add automated `audit` + Dependabot.
