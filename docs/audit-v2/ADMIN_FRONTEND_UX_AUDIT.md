# Admin — Frontend / UX Re-Audit (v2)

## Security-adjacent frontend
- **XSS:** React escapes by default; no `dangerouslySetInnerHTML` found in pages reviewed. Nicknames render as text. ✅ (re-check any future `LiveFeed`/search highlight that injects HTML).
- **CSV/formula injection:** prior audit flagged sanitisation; any export must prefix `=,+,-,@` cells with `'`. Verify in the export path before shipping new exports. ⚠️ (V2-UX-1)
- **Token in JS:** none — session is HttpOnly cookie. ✅
- **Stale cache after logout:** logout does `qc.cancelQueries(); qc.clear()` before flipping UI and fire-and-forget server clear — good; but the JWT remains valid until exp (see Auth doc). ✅ UI / ⚠️ token.
- **Optimistic success:** mutations await server ack (`apiMutate` throws on `!ok`) before toasting success — must keep this in the new modal (brief: no optimistic success before ack). ✅
- **Open redirects / direct route nav:** SPA fallback present (`_redirects`); 401 from API resets cached session. Verify protected routes redirect to login on `unauthorized` throw. ✅ mostly.

## UX / data correctness
- **V2-UX-2 (MED):** Sidebar shows `v1.1` hardcoded; top bar shows production URL only. No global LIVE/connection status, no last-event age, no stale-data warning, no manual resync that reconciles (current "Sync" does `qc.clear()` → full refetch storm). The new Command Center adds these.
- **V2-UX-3 (LOW):** `Sync` button calls `qc.clear()+invalidateQueries()` → invalidates *everything* (the anti-pattern the brief warns about). Replace with scoped resync.
- **V2-UX-4 (LOW):** Empty/loading/error states inconsistent across pages; standardise skeletons + empty illustrations + 401/403/404/500 screens.
- **V2-UX-5 (LOW):** Dark theme unreadable opacity (`text-ink-500` on dark) — moot after light migration but watch contrast (WCAG AA) on `--sr-text-subtle`.
- **Recharts:** dark ticks (`#5a5a6e`) + near-monochrome series — fix in light migration with a 6-colour semantic palette + visible tooltips/legend/zero-state.

## Accessibility
- Add visible focus rings (gold) on rows/inputs/buttons; ensure keyboard nav on tables and command palette; respect `prefers-reduced-motion` for the new live animations.

## Performance
- Single 848 kB JS chunk (no code-split) — acceptable for an internal tool but add route-level `lazy()` for heavy pages (Insights/Economy/Recharts) to cut first paint. (V2-UX-6, LOW)
