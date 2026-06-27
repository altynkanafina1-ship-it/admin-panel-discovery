# Admin — Light Theme Migration Plan

## Source of truth
Reuse the game's light-premium semantic tokens (`src/index.css` on `feat/light-premium-game-theme`). Verified values:
```
--sr-bg #F5EFE6 · --sr-bg-soft #EFE6D8 · --sr-bg-deep #E8DCC8
--sr-surface #FFFDF8 · --sr-surface-2 #FAF3E6 · --sr-surface-muted #EDE1D2
--sr-text #2B241E · --sr-text-muted #77695D · --sr-text-subtle #A9988A
--sr-border #D9C9B7 · --sr-border-soft #E6D7C2 · --sr-border-strong #C2AB8D
--sr-wood-light #D7B48A · --sr-wood-mid #B58863 · --sr-wood-deep #815B43
--sr-gold #C39A48 · --sr-gold-deep #A77E2E · --sr-gold-soft #E3C97B
--sr-danger #A74740 · --sr-success #56815D · --sr-info #3F6E94 · --sr-warning #BC8B33
```
Fonts: **Inter** (UI/tables), **Cinzel** (brand/rare large headings), **JetBrains Mono** (IDs/hashes/technical).

## Current dark inventory (to replace)
- `:root { color-scheme: dark }`, body radial-gradients over `#07070a`.
- Tailwind palette: `ink-*` (dark), `gold-*` (ok-ish but dark-tuned), `accent.{rose,mint,sky}`.
- Component classes: `.panel` (`bg-ink-900/60`), `.panel-soft`, `.kpi`, `.btn-gold/.btn-ghost`, `.chip-*`, `.row-hover` (`hover:bg-white/[0.025]`).
- ~25 files use `ink-*`, `bg-white/[...]`, `border-white/[...]`, dark Recharts tick fill `#5a5a6e`, dark scrollbars.
- Brand uses `Fraunces` display serif → switch brand to **Cinzel**; switch sans to **Inter**.

## Strategy (semantic layer, not blind hex swap)
1. Add `--admin-*` semantic tokens mapped to `--sr-*` in `:root` (light), e.g.:
   `--admin-bg→--sr-bg`, `--admin-surface→--sr-surface`, `--admin-text→--sr-text`, `--admin-primary→--sr-gold`, `--admin-danger/success/info/warning→--sr-*`, `--admin-live→--sr-success`, plus `--admin-border`, `--admin-shadow-sm/md`, `--admin-radius`.
2. Re-point the Tailwind `ink`/`gold`/`accent` scales **and** add `sr`/`admin` colour keys so existing `ink-*`/`white/[..]` utilities resolve to light values — minimising churn while we migrate class-by-class.
3. Rewrite `@layer components` (`.panel`, `.kpi`, `.btn-*`, `.chip-*`, `.row-hover`) to light surfaces, soft wood borders, subtle gold accents, readable text.
4. Recharts: light axis ticks (`--sr-text-muted`), grid `--sr-border-soft`, series palette = gold / wood-mid / sage(success) / info-blue / warning-amber / danger-red (no five near-identical beiges).
5. Scrollbars + selection → warm light.
6. Brand wordmark → Cinzel; data/IDs → mono; everything else → Inter.

## Action colour semantics
grant = gold/success · adjustment = warning · refund = info · suspension = danger · unsuspend = success.

## Components to bring into the system
login, app shell, sidebar, top bar, Overview, Players, Player 360, Matches, Match Detail, Insights, Economy, System Health, Roadmap, tables, pagination, filters, search, charts, KPI cards, dialogs, grant/refund/suspend modal, toasts, empty states, skeletons, error states (401/403/404/500), realtime status, live event timeline.

## Tables requirements
light surface, sticky header, clear row separation, readable hover, selected state, keyboard focus ring (gold), dense mode, responsive horizontal scroll, meaningful empty state, realtime update marker, no layout jump.

## Guardrails
- Keep professional data density; not stark white, not casino, not landing page.
- No emoji icons (use lucide-react).
- Implemented on `feat/admin-light-realtime`; verified by `yarn typecheck && yarn build` + screenshots; Cloudflare branch preview.
